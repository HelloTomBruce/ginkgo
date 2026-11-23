import React, { useId } from "react";

interface GinkgoLogoProps {
  /** Tailwind 尺寸类，如 "w-5 h-5" */
  className?: string;
  /** 覆盖叶身颜色（默认 currentColor，跟随文字色自动适配亮暗） */
  leafColor?: string;
}

/**
 * Ginkgo 平台 logo：双瓣银杏叶 + 叶面彩色泼溅。
 * 泼溅色用图表色板语义 token（--chart-1..5），亮暗主题自动成立；
 * 叶身默认 currentColor，由宿主文字色控制。
 */
export function GinkgoLogo({ className = "w-5 h-5", leafColor }: GinkgoLogoProps) {
  const clipId = useId();
  const leaf = leafColor ?? "currentColor";
  return (
    <svg viewBox="0 0 96 96" className={className} aria-hidden="true" focusable="false">
      <defs>
        <clipPath id={clipId}>
          <path d="M48 72C50 60 52.5 47 57 33Q59 27 63.5 29.5C73 35 81 41.5 84 48.5Q86 53.5 82 56C70.5 63.5 58.5 68.5 50.5 71.5Z" />
          <path d="M48 72C46 60 43.5 47 39 33Q37 27 32.5 29.5C23 35 15 41.5 12 48.5Q10 53.5 14 56C25.5 63.5 37.5 68.5 45.5 71.5Z" />
        </clipPath>
      </defs>
      <path
        fill={leaf}
        d="M48 72C50 60 52.5 47 57 33Q59 27 63.5 29.5C73 35 81 41.5 84 48.5Q86 53.5 82 56C70.5 63.5 58.5 68.5 50.5 71.5Z"
      />
      <path
        fill={leaf}
        d="M48 72C46 60 43.5 47 39 33Q37 27 32.5 29.5C23 35 15 41.5 12 48.5Q10 53.5 14 56C25.5 63.5 37.5 68.5 45.5 71.5Z"
      />
      {/* 泼溅层：裁进叶形内，色板取 --chart-4/2/3/1/5（陶土金/松石绿/岩石紫/石墨蓝/砖红灰） */}
      <g clipPath={`url(#${clipId})`}>
        <path
          d="M41.8 44.0C42.0 46.2 43.6 49.5 42.6 51.0C41.7 52.6 38.1 53.0 36.0 53.3C33.9 53.7 32.1 53.5 30.1 53.1C28.0 52.6 25.2 52.1 23.9 50.6C22.6 49.1 22.2 46.1 22.4 44.0C22.6 41.9 23.8 40.0 25.0 38.2C26.2 36.4 27.6 34.0 29.5 33.2C31.4 32.4 34.5 32.4 36.5 33.2C38.5 34.0 40.7 35.9 41.6 37.7C42.5 39.5 41.6 41.8 41.8 44.0Z"
          fill="var(--chart-4)"
        />
        <circle cx="24" cy="52" r="2.2" fill="var(--chart-4)" />
        <circle cx="43" cy="33.5" r="1.6" fill="var(--chart-4)" />
        <path
          d="M72.7 53.0C72.5 54.6 72.6 55.9 71.9 57.3C71.3 58.7 70.2 60.8 68.7 61.4C67.3 62.1 64.7 62.1 63.3 61.3C61.9 60.6 61.4 58.4 60.4 57.0C59.5 55.6 57.7 54.5 57.4 53.0C57.2 51.5 57.9 49.1 58.9 47.8C59.9 46.6 61.9 45.7 63.5 45.3C65.1 44.9 66.9 44.9 68.5 45.3C70.1 45.7 72.6 46.4 73.3 47.7C74.0 49.0 72.9 51.4 72.7 53.0Z"
          fill="var(--chart-2)"
        />
        <circle cx="74.5" cy="43" r="1.8" fill="var(--chart-2)" />
        <path
          d="M62.1 33.0C62.3 34.1 62.8 35.6 62.4 36.6C61.9 37.5 60.5 38.7 59.4 38.9C58.3 39.1 57.0 38.4 55.9 37.9C54.9 37.4 53.7 37.0 53.1 36.2C52.5 35.4 52.2 34.0 52.3 33.0C52.3 32.0 52.7 30.8 53.2 29.9C53.8 29.0 54.7 27.9 55.7 27.5C56.7 27.0 58.4 27.0 59.3 27.4C60.3 27.9 60.9 29.2 61.4 30.2C61.9 31.1 62.0 31.9 62.1 33.0Z"
          fill="var(--chart-3)"
        />
        <circle cx="64" cy="27.5" r="1.3" fill="var(--chart-3)" />
        <circle cx="28" cy="59" r="4.2" fill="var(--chart-1)" />
        <circle cx="46.5" cy="64" r="2.2" fill="var(--chart-5)" />
        <circle cx="55" cy="61" r="1.5" fill="var(--chart-4)" />
      </g>
      <path
        d="M48 73L47.2 79.5"
        stroke={leaf}
        strokeWidth="5.5"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}
