import {
  CalendarDays,
  ChartNoAxesColumn,
  ClipboardCheck,
  FileText,
  KanbanSquare,
  Lightbulb,
  type LucideIcon,
  PhoneCall,
  Sun,
  UserSearch,
} from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";

export interface DockItem {
  id: string;
  name: string;
  to: string;
  icon: LucideIcon;
  badge?: number;
  color?: string;
}

export const SALES_DOCK_ITEMS: DockItem[] = [
  { id: "today", name: "Today", to: "/", icon: Sun, color: "#00cfc8" },
  {
    id: "dialer",
    name: "Dialer",
    to: "/dialer",
    icon: PhoneCall,
    color: "#38bdf8",
  },
  {
    id: "calendar",
    name: "Calendar",
    to: "/calendar",
    icon: CalendarDays,
    color: "#818cf8",
  },
  {
    id: "leads",
    name: "Leads",
    to: "/leads",
    icon: UserSearch,
    color: "#a78bfa",
  },
  {
    id: "pipeline",
    name: "Pipeline",
    to: "/pipeline",
    icon: KanbanSquare,
    color: "#f472b6",
  },
  {
    id: "proposals",
    name: "Proposals",
    to: "/proposals",
    icon: FileText,
    color: "#fb923c",
  },
  {
    id: "numbers",
    name: "Numbers",
    to: "/numbers",
    icon: ChartNoAxesColumn,
    color: "#4ade80",
  },
  {
    id: "deck",
    name: "Pitch Deck",
    to: "/deck",
    icon: Lightbulb,
    color: "#facc15",
  },
  {
    id: "eod",
    name: "End of Day",
    to: "/eod",
    icon: ClipboardCheck,
    color: "#2dd4bf",
  },
];

interface MacOSDockProps {
  items?: DockItem[];
  owedCount?: number;
  className?: string;
  baseSize?: number;
  maxScale?: number;
}

/**
 * Authentic macOS Dock (SF-01):
 * Cosine proximity magnification, fluid spring animation, click bounce,
 * open route indicator dots, and frosted Deep Space glass surface.
 */
export function MacOSDock({
  items = SALES_DOCK_ITEMS,
  owedCount = 0,
  className = "",
  baseSize = 40,
  maxScale = 1.45,
}: MacOSDockProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [mouseX, setMouseX] = useState<number | null>(null);
  const [currentScales, setCurrentScales] = useState<number[]>(
    items.map(() => 1),
  );
  const [currentPositions, setCurrentPositions] = useState<number[]>([]);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const dockRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const animationFrameRef = useRef<number | undefined>(undefined);

  const baseSpacing = 8;
  const effectWidth = baseSize * 2.8;

  // Cosine-based magnification algorithm (exact macOS dock algorithm from SF-01)
  const calculateTargetMagnification = useCallback(
    (mousePosition: number | null) => {
      if (mousePosition === null) return items.map(() => 1.0);

      return items.map((_, index) => {
        const itemCenter = currentPositions[index] || 0;
        const distance = Math.abs(mousePosition - itemCenter);

        if (distance > effectWidth) return 1.0;

        const normalizedDistance = distance / effectWidth;
        const cosineValue = (Math.cos(normalizedDistance * Math.PI) + 1) / 2;
        return 1.0 + (maxScale - 1.0) * cosineValue;
      });
    },
    [items, currentPositions, effectWidth, maxScale],
  );

  const calculatePositions = useCallback(
    (scales: number[]) => {
      const positions: number[] = [];
      let currentX = baseSize / 2;

      for (let i = 0; i < scales.length; i++) {
        if (i > 0) {
          const prevHalfWidth = (baseSize * scales[i - 1]) / 2;
          const currentHalfWidth = (baseSize * scales[i]) / 2;
          currentX += prevHalfWidth + baseSpacing + currentHalfWidth;
        }
        positions.push(currentX);
      }
      return positions;
    },
    [baseSize, baseSpacing],
  );

  useEffect(() => {
    const initialPositions = calculatePositions(items.map(() => 1));
    setCurrentPositions(initialPositions);
  }, [items, calculatePositions]);

  // Smooth animation interpolation loop
  const animateToTarget = useCallback(() => {
    const targetScales = calculateTargetMagnification(mouseX);
    const targetPositions = calculatePositions(targetScales);

    let needsAnimation = false;
    const lerpFactor = 0.22;

    const newScales = currentScales.map((current, index) => {
      const target = targetScales[index];
      const diff = target - current;
      if (Math.abs(diff) > 0.003) {
        needsAnimation = true;
        return current + diff * lerpFactor;
      }
      return target;
    });

    const newPositions = currentPositions.map((current, index) => {
      const target = targetPositions[index];
      const diff = target - current;
      if (Math.abs(diff) > 0.1) {
        needsAnimation = true;
        return current + diff * lerpFactor;
      }
      return target;
    });

    setCurrentScales(newScales);
    setCurrentPositions(newPositions);

    if (needsAnimation) {
      animationFrameRef.current = requestAnimationFrame(animateToTarget);
    }
  }, [
    mouseX,
    calculateTargetMagnification,
    calculatePositions,
    currentScales,
    currentPositions,
  ]);

  useEffect(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    animationFrameRef.current = requestAnimationFrame(animateToTarget);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [animateToTarget]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dockRef.current) return;
    const rect = dockRef.current.getBoundingClientRect();
    const relativeX = e.clientX - rect.left - 12; // 12px padding offset
    setMouseX(relativeX);
  }, []);

  const handleMouseLeave = useCallback(() => {
    setMouseX(null);
    setHoveredIndex(null);
  }, []);

  // Authentic macOS click bounce animation
  const triggerBounce = (el: HTMLElement) => {
    el.animate(
      [
        { transform: "translateY(0)" },
        { transform: "translateY(-14px)" },
        { transform: "translateY(0)" },
        { transform: "translateY(-6px)" },
        { transform: "translateY(0)" },
      ],
      { duration: 420, easing: "cubic-bezier(0.28, 0.84, 0.42, 1)" },
    );
  };

  const handleClick = (item: DockItem, index: number) => {
    const el = itemRefs.current[index];
    if (el) triggerBounce(el);
    navigate(item.to);
  };

  const contentWidth =
    currentPositions.length > 0
      ? Math.max(
          ...currentPositions.map(
            (pos, index) => pos + (baseSize * currentScales[index]) / 2,
          ),
        )
      : items.length * (baseSize + baseSpacing) - baseSpacing;

  const padding = 10;

  return (
    <div
      role="navigation"
      aria-label="Quick navigation"
      ref={dockRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      className={`floating-dock relative flex items-center justify-center ${className}`}
      style={{
        width: `${Math.round(contentWidth + padding * 2)}px`,
        padding: `${padding}px`,
      }}
    >
      <div
        className="relative"
        style={{
          height: `${baseSize}px`,
          width: "100%",
        }}
      >
        {items.map((item, index) => {
          const scale = currentScales[index] || 1;
          const position = currentPositions[index] || 0;
          const scaledSize = baseSize * scale;
          const Icon = item.icon;
          const isActive =
            item.to === "/"
              ? location.pathname === "/"
              : location.pathname.startsWith(item.to);

          const badgeVal =
            item.id === "calendar" || item.id === "today"
              ? owedCount
              : (item.badge ?? 0);

          return (
            <button
              key={item.id}
              ref={el => {
                itemRefs.current[index] = el;
              }}
              type="button"
              onClick={() => handleClick(item, index)}
              onMouseEnter={() => setHoveredIndex(index)}
              title={item.name}
              className="absolute bottom-0 flex cursor-pointer flex-col items-center justify-end border-0 bg-transparent p-0 outline-none"
              style={{
                left: `${Math.round(position - scaledSize / 2)}px`,
                width: `${Math.round(scaledSize)}px`,
                height: `${Math.round(scaledSize)}px`,
                transformOrigin: "bottom center",
                zIndex: Math.round(scale * 10),
              }}
            >
              {/* Tooltip on hover */}
              {hoveredIndex === index && (
                <div
                  className="pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md border border-white/10 bg-[#091333]/90 px-2 py-0.5 text-[11px] font-medium text-white shadow-lg backdrop-blur-md"
                  style={{ zIndex: 100 }}
                >
                  {item.name}
                </div>
              )}

              {/* Icon Container with subtle glass tint */}
              <div
                className={`relative flex items-center justify-center rounded-[12px] border transition-colors ${
                  isActive
                    ? "border-teal-400/50 bg-teal-500/20 text-teal-300 shadow-[0_0_12px_rgba(0,207,200,0.3)]"
                    : "border-white/10 bg-white/[0.06] text-white/80 hover:border-white/20 hover:bg-white/[0.1] hover:text-white"
                }`}
                style={{
                  width: `${Math.round(scaledSize)}px`,
                  height: `${Math.round(scaledSize)}px`,
                }}
              >
                <Icon
                  style={{
                    width: `${Math.round(Math.max(16, scaledSize * 0.5))}px`,
                    height: `${Math.round(Math.max(16, scaledSize * 0.5))}px`,
                  }}
                  strokeWidth={1.8}
                  aria-hidden
                />

                {/* Notification Badge */}
                {badgeVal > 0 ? (
                  <span
                    className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-bold text-black tabular-nums shadow-sm"
                    style={{ background: "var(--owed)" }}
                  >
                    {badgeVal}
                  </span>
                ) : null}
              </div>

              {/* Active Route Dot (authentic macOS dock dot) */}
              {isActive && (
                <div
                  className="absolute -bottom-1.5 left-1/2 size-1 -translate-x-1/2 rounded-full bg-teal-400 shadow-[0_0_6px_#00cfc8]"
                  aria-hidden
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
