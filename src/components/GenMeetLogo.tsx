import React, { useId } from "react";

interface GenMeetLogoProps {
  dark?: boolean;
  size?: "sm" | "md";
}

export function GenMeetLogo({ dark = false, size = "md" }: GenMeetLogoProps) {
  const uid = useId().replace(/:/g, "");
  const gradId = `genmeet-bg-${uid}`;
  const iconSize = size === "sm" ? 30 : 36;
  const textClass = size === "sm" ? "text-[19px]" : "text-[22px]";

  return (
    <div className="inline-flex items-center gap-2.5 select-none">
      <svg
        width={iconSize}
        height={iconSize}
        viewBox="0 0 48 48"
        fill="none"
        aria-hidden="true"
      >
        <defs>
          <linearGradient
            id={gradId}
            x1="4"
            y1="4"
            x2="44"
            y2="44"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" stopColor="#1D4ED8" />
            <stop offset="55%" stopColor="#1A73E8" />
            <stop offset="100%" stopColor="#06B6D4" />
          </linearGradient>
        </defs>

        {/* Rounded squircle badge */}
        <rect x="2" y="2" width="44" height="44" rx="13" fill={`url(#${gradId})`} />
        <rect
          x="2.75"
          y="2.75"
          width="42.5"
          height="42.5"
          rx="12.25"
          stroke="#FFFFFF"
          strokeOpacity="0.2"
          strokeWidth="1.5"
        />

        {/* Stylized "G" camera body */}
        <path
          d="M25.72 17.28A9.5 9.5 0 1 0 28.5 24H21.5"
          stroke="#FFFFFF"
          strokeWidth="3.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Video lens wing */}
        <path
          d="M32.5 20.6C32.5 19.9 32.9 19.25 33.55 18.92L38.15 16.58C39.25 16.02 40.5 16.82 40.5 18.05V29.95C40.5 31.18 39.25 31.98 38.15 31.42L33.55 29.08C32.9 28.75 32.5 28.1 32.5 27.4V20.6Z"
          fill="#99F6E4"
        />
      </svg>

      <span
        className={`${textClass} tracking-[-0.025em] ${
          dark ? "text-[#e8eaed]" : "text-[#202124]"
        }`}
      >
        <span
          className={`font-bold ${
            dark ? "text-[#8ab4f8]" : "text-[#1a73e8]"
          }`}
        >
          Gen
        </span>
        <span className="font-medium">Meet</span>
      </span>
    </div>
  );
}
