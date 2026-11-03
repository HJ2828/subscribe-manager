import { useEffect, useMemo, useRef, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import {
  forceCollide,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationNodeDatum,
} from "d3-force";

export interface BubbleChartItem {
  id: string;
  name: string;
  value: number;
  valueText: string;
}

interface BubbleNode extends SimulationNodeDatum, BubbleChartItem {
  radius: number;
}

interface DragState {
  id: string;
  pointerId: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  lastAt: number;
  velocityX: number;
  velocityY: number;
  moved: boolean;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function BubbleForceChart({
  items,
  selectedId,
  onSelect,
}: {
  items: BubbleChartItem[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const elementsRef = useRef(new Map<string, HTMLButtonElement>());
  const nodesRef = useRef(new Map<string, BubbleNode>());
  const simulationRef = useRef<Simulation<BubbleNode, undefined> | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const reducedMotionRef = useRef(false);
  const extraRows = Math.max(0, Math.ceil((items.length - 10) / 5));
  const containerStyle = { "--bubble-extra-rows": extraRows } as CSSProperties;
  const itemKey = useMemo(
    () => items.map((item) => `${item.id}:${item.value}`).join("|"),
    [items],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !items.length) return;

    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    reducedMotionRef.current = reduceMotion;
    let width = container.clientWidth;
    let height = container.clientHeight;
    const maximum = Math.max(1, ...items.map((item) => item.value));
    const goldenAngle = Math.PI * (3 - Math.sqrt(5));
    const nodes: BubbleNode[] = items.map((item, index) => {
      const radius = 18 + Math.sqrt(item.value / maximum) * 40;
      const distance = Math.min(width, height) * 0.055 * Math.sqrt(index);
      return {
        ...item,
        radius,
        x: width / 2 + Math.cos(index * goldenAngle) * distance,
        y: height / 2 + Math.sin(index * goldenAngle) * distance,
      };
    });
    nodesRef.current = new Map(nodes.map((node) => [node.id, node]));

    const keepInside = (node: BubbleNode) => {
      const bounce = 0.68;
      if ((node.x || 0) < node.radius) {
        node.x = node.radius;
        node.vx = Math.abs(node.vx || 0) * bounce;
      } else if ((node.x || 0) > width - node.radius) {
        node.x = width - node.radius;
        node.vx = -Math.abs(node.vx || 0) * bounce;
      }
      if ((node.y || 0) < node.radius) {
        node.y = node.radius;
        node.vy = Math.abs(node.vy || 0) * bounce;
      } else if ((node.y || 0) > height - node.radius) {
        node.y = height - node.radius;
        node.vy = -Math.abs(node.vy || 0) * bounce;
      }
    };
    const paint = () => {
      nodes.forEach((node) => {
        keepInside(node);
        const element = elementsRef.current.get(node.id);
        if (!element) return;
        element.style.left = `${node.x || 0}px`;
        element.style.top = `${node.y || 0}px`;
        element.style.width = `${node.radius * 2}px`;
        element.style.height = `${node.radius * 2}px`;
      });
    };
    const simulation = forceSimulation(nodes)
      .alpha(1)
      .alphaDecay(0.028)
      .velocityDecay(0.22)
      .force("x", forceX(() => width / 2).strength(0.018))
      .force("y", forceY(() => height / 2).strength(0.018))
      .force("attraction", forceManyBody().strength(5))
      .force("collision", forceCollide<BubbleNode>().radius((node) => node.radius + 1.5).strength(0.92).iterations(3))
      .on("tick", paint);
    simulationRef.current = simulation;

    for (let tick = 0; tick < 90; tick += 1) simulation.tick();
    paint();
    if (reduceMotion) simulation.stop();
    else simulation.alpha(0.32).restart();

    const observer = new ResizeObserver(() => {
      width = container.clientWidth;
      height = container.clientHeight;
      simulation.force("x", forceX(() => width / 2).strength(0.018));
      simulation.force("y", forceY(() => height / 2).strength(0.018));
      simulation.alpha(0.22).restart();
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
      simulation.stop();
      simulationRef.current = null;
      nodesRef.current.clear();
    };
  }, [itemKey]);

  function repelNearby(clientX: number, clientY: number) {
    if (reducedMotionRef.current || dragRef.current) return;
    const container = containerRef.current;
    const simulation = simulationRef.current;
    if (!container || !simulation) return;
    const bounds = container.getBoundingClientRect();
    const pointerX = clientX - bounds.left;
    const pointerY = clientY - bounds.top;
    let affected = false;
    nodesRef.current.forEach((node) => {
      const dx = (node.x || 0) - pointerX;
      const dy = (node.y || 0) - pointerY;
      const distance = Math.max(1, Math.hypot(dx, dy));
      const reach = node.radius + 104;
      if (distance >= reach) return;
      const push = (1 - distance / reach) * 7;
      node.vx = (node.vx || 0) + (dx / distance) * push;
      node.vy = (node.vy || 0) + (dy / distance) * push;
      affected = true;
    });
    if (affected) simulation.alpha(Math.max(simulation.alpha(), 0.24)).restart();
  }

  function startDrag(event: ReactPointerEvent<HTMLButtonElement>, id: string) {
    const node = nodesRef.current.get(id);
    const simulation = simulationRef.current;
    if (!node || !simulation) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      lastAt: performance.now(),
      velocityX: 0,
      velocityY: 0,
      moved: false,
    };
    node.fx = node.x;
    node.fy = node.y;
    if (!reducedMotionRef.current) simulation.alphaTarget(0.16).restart();
  }

  function moveDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    const container = containerRef.current;
    const simulation = simulationRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !container || !simulation) return;
    const node = nodesRef.current.get(drag.id);
    if (!node) return;
    const bounds = container.getBoundingClientRect();
    node.fx = clamp(event.clientX - bounds.left, node.radius, bounds.width - node.radius);
    node.fy = clamp(event.clientY - bounds.top, node.radius, bounds.height - node.radius);
    drag.moved ||= Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 6;
    const now = performance.now();
    const elapsed = Math.max(8, now - drag.lastAt);
    drag.velocityX = clamp(((event.clientX - drag.lastX) / elapsed) * 12, -16, 16);
    drag.velocityY = clamp(((event.clientY - drag.lastY) / elapsed) * 12, -16, 16);
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
    drag.lastAt = now;
    if (reducedMotionRef.current) {
      node.x = node.fx;
      node.y = node.fy;
      const element = elementsRef.current.get(node.id);
      if (element) {
        element.style.left = `${node.x}px`;
        element.style.top = `${node.y}px`;
      }
    } else {
      simulation.alpha(Math.max(simulation.alpha(), 0.16)).restart();
    }
  }

  function finishDrag(event: ReactPointerEvent<HTMLButtonElement>, cancelled = false) {
    const drag = dragRef.current;
    const simulation = simulationRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !simulation) return;
    const node = nodesRef.current.get(drag.id);
    if (node) {
      node.fx = null;
      node.fy = null;
      node.vx = drag.velocityX;
      node.vy = drag.velocityY;
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    dragRef.current = null;
    simulation.alphaTarget(0);
    if (!reducedMotionRef.current) simulation.alpha(0.38).restart();
    if (!cancelled && !drag.moved) onSelect(drag.id);
  }

  if (!items.length) return null;

  return (
    <div
      ref={containerRef}
      className="bubble-force-chart"
      style={containerStyle}
      onPointerMove={(event) => repelNearby(event.clientX, event.clientY)}
      onPointerLeave={() => simulationRef.current?.alphaTarget(0)}
      aria-label="구독 서비스 버블 차트"
    >
      {items.map((item) => {
        const shortName = item.name.trim().slice(0, item.name.length <= 4 ? 4 : 3) || "?";
        return (
          <button
            type="button"
            key={item.id}
            ref={(element) => { if (element) elementsRef.current.set(item.id, element); else elementsRef.current.delete(item.id); }}
            className={selectedId === item.id ? "selected" : ""}
            aria-label={`${item.name} · ${item.valueText}`}
            aria-pressed={selectedId === item.id}
            title={`${item.name} · ${item.valueText}`}
            onPointerDown={(event) => startDrag(event, item.id)}
            onPointerMove={moveDrag}
            onPointerUp={finishDrag}
            onPointerCancel={(event) => finishDrag(event, true)}
            onClick={(event) => { if (event.detail === 0) onSelect(item.id); }}
          >
            <span aria-hidden="true">{shortName}</span>
          </button>
        );
      })}
      <small className="bubble-size-note">작은 값은 선택할 수 있도록 최소 크기로 보정돼요. 정확한 값은 상세와 표에서 확인하세요.</small>
    </div>
  );
}
