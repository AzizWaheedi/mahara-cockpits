import { ArrowUpRight } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { LANES, type LaunchPipeline } from "@/lib/launchModel";
export function LaunchLine({ data }: { data: LaunchPipeline }) {
  const [active, setActive] = useState("onboarding");
  useEffect(() => {
    const observer = new IntersectionObserver(
      entries => {
        for (const e of entries)
          if (e.isIntersecting) setActive(e.target.id.replace("launch-", ""));
      },
      { rootMargin: "-20% 0px -60% 0px" },
    );
    for (const lane of LANES) {
      const el = document.getElementById(`launch-${lane.id}`);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, []);
  const [draw] = useState(() => {
    try {
      const seen = sessionStorage.getItem("launch-line-seen");
      sessionStorage.setItem("launch-line-seen", "1");
      return !seen;
    } catch {
      return false;
    }
  });
  const lastOccupied = Math.max(
    0,
    ...LANES.map((lane, index) => (data.lanes[lane.id] ? index : 0)),
  );
  return (
    <nav className="launch-line" aria-label="Launch stages">
      <div className="launch-return" aria-hidden="true">
        <span>No spend for 7 days</span>
        <svg
          aria-hidden="true"
          viewBox="0 0 1000 46"
          preserveAspectRatio="none"
        >
          <path d="M827 44 V22 Q827 7 807 7 H447 Q427 7 427 22 V44" />
        </svg>
      </div>
      <div className="launch-stations">
        <svg
          className={`launch-live-track ${draw ? "draw" : ""}`}
          aria-hidden="true"
          viewBox="0 0 100 2"
          preserveAspectRatio="none"
        >
          <path pathLength="1" d={`M0 1 H${lastOccupied * 25}`} />
        </svg>
        {LANES.map(l => {
          const contents = (
            <>
              <span
                className={`launch-node ${l.id === "ads" ? "launch-terminal" : ""}`}
                aria-hidden="true"
              />
              <span className="launch-count">{data.lanes[l.id]}</span>
              <span className="launch-station-label">
                {l.name}
                {l.id === "ads" && <ArrowUpRight size={13} />}
              </span>
              <span className="launch-station-rule">{l.rule}</span>
              {l.id === "nothing" && (
                <span className="launch-mobile-return">
                  Includes clients that left Ads
                </span>
              )}
            </>
          );
          return l.id === "ads" ? (
            <Link key={l.id} to="/ads" className="launch-station">
              {contents}
            </Link>
          ) : (
            <button
              type="button"
              key={l.id}
              className={`launch-station ${active === l.id ? "is-current" : ""} ${data.lanes[l.id] ? "has-clients" : ""}`}
              aria-controls={`launch-${l.id}`}
              onClick={() =>
                document.getElementById(`launch-${l.id}`)?.scrollIntoView({
                  behavior: window.matchMedia(
                    "(prefers-reduced-motion: reduce)",
                  ).matches
                    ? "instant"
                    : "smooth",
                  block: "start",
                })
              }
            >
              {contents}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
