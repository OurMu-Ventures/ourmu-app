"use client";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
const FishCanvas = dynamic(() => import("@/components/FishCanvas"), {
  ssr: false,
});
export function FishExperience() {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setEnabled(!reduced.matches);
    update();
    reduced.addEventListener("change", update);
    return () => {
      reduced.removeEventListener("change", update);
    };
  }, []);
  if (!enabled) return null;
  return (
    <div className="fish-frame" aria-hidden="true">
      <FishCanvas />
      <span className="fish-note">
        Click the water to feed the fish · Lake Victoria species
      </span>
    </div>
  );
}
