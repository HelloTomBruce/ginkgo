import React, { useId } from "react";

interface GinkgoLogoProps {
  /** Tailwind 尺寸类，如 "w-5 h-5" */
  className?: string;
  /** 单色覆盖（叶身/叶柄同色，无叶脉——跟随文字色等场景）；缺省为秋金渐变品牌形态 */
  leafColor?: string;
}

/** 写实银杏叶轮廓：波浪扇缘 + 中央浅裂（biloba）+ 楔形收底（参数化生成后物化） */
const BLADE =
  "M12.9 62.8 Q33.7 59.0 48 64 Q62.3 59.0 82.8 62.8 L83.7 61.5 L84.4 60.2 L85.0 58.8 L85.4 57.4 L85.6 56.0 L85.6 54.6 L85.5 53.2 L85.3 51.9 L85.0 50.5 L84.5 49.3 L83.9 48.0 L83.2 46.8 L82.5 45.6 L81.8 44.5 L81.1 43.3 L80.4 42.1 L79.7 41.0 L78.9 39.8 L78.2 38.7 L77.4 37.6 L76.6 36.4 L75.7 35.3 L74.8 34.2 L73.9 33.1 L73.0 32.0 L72.0 31.0 L70.9 30.0 L69.9 29.0 L68.7 28.1 L67.6 27.2 L66.3 26.4 L65.1 25.6 L63.8 24.9 L62.5 24.3 L61.1 23.8 L59.7 23.3 L58.2 23.2 L56.6 23.3 L55.0 24.0 L53.4 25.5 L51.8 27.6 L50.4 29.9 L49.1 31.9 L48.0 32.8 L46.9 32.3 L45.7 30.7 L44.3 28.7 L42.8 26.9 L41.3 25.8 L39.8 25.3 L38.4 25.4 L37.0 25.7 L35.7 26.3 L34.5 26.9 L33.2 27.5 L32.0 28.1 L30.8 28.8 L29.6 29.5 L28.5 30.2 L27.3 30.9 L26.1 31.6 L25.0 32.3 L23.8 33.1 L22.7 33.8 L21.6 34.6 L20.4 35.4 L19.3 36.3 L18.2 37.2 L17.1 38.1 L16.0 39.0 L15.0 40.0 L14.0 41.1 L13.0 42.1 L12.1 43.3 L11.2 44.4 L10.4 45.7 L9.6 46.9 L9.0 48.2 L8.5 49.6 L8.2 51.1 L8.1 52.6 L8.2 54.1 L8.5 55.6 L9.0 57.1 L9.7 58.6 L10.6 60.1 L11.7 61.5 L12.9 62.8 Z";
/** 细长弧柄 */
const PETIOLE = "M48 63 C46.8 72 48.4 80 53.5 88";
/** 二叉分歧叶脉（8 主脉 × 中段分叉，裁剪于叶形内） */
const VEINS =
  "M41.5 61.4 Q38.3 58.9 25.4 54.9 M25.4 54.9 Q17.8 52.5 11.8 53.3 M25.4 54.9 Q20.3 47.2 14.5 46.5 M42.8 59.4 Q40.6 55.9 29.7 47.9 M29.7 47.9 Q22.9 43.6 17.4 41.8 M29.7 47.9 Q27.0 39.4 22.2 36.4 M44.6 57.9 Q43.7 53.9 36.1 42.7 M36.1 42.7 Q30.6 36.7 26.5 32.9 M36.1 42.7 Q35.8 34.0 32.8 29.4 M46.8 57.1 Q47.3 53.1 43.9 40.0 M43.9 40.0 Q40.0 32.6 38.1 27.5 M43.9 40.0 Q45.8 31.7 45.2 26.3 M49.2 57.1 Q51.0 53.4 52.1 40.0 M52.1 40.0 Q50.2 31.7 50.8 26.3 M52.1 40.0 Q56.0 32.6 57.9 27.5 M51.4 57.9 Q54.3 55.0 59.9 42.7 M59.9 42.7 Q60.2 34.0 63.2 29.4 M59.9 42.7 Q65.4 36.7 69.5 32.9 M53.2 59.4 Q56.9 57.6 66.3 47.9 M66.3 47.9 Q69.0 39.4 73.8 36.4 M66.3 47.9 Q73.1 43.6 78.6 41.8 M54.5 61.4 Q58.5 61.0 70.6 54.9 M70.6 54.9 Q75.7 47.2 81.5 46.5 M70.6 54.9 Q78.2 52.5 84.2 53.3";

/**
 * Ginkgo 平台 logo：写实秋金银杏叶。
 * 默认品牌形态（金渐变 + 顶部高光 + 二叉叶脉 + 弧柄）；
 * 传入 leafColor 时退化为单色剪影（跟随文字色自动适配亮暗）。
 */
export function GinkgoLogo({ className = "w-5 h-5", leafColor }: GinkgoLogoProps) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const gradId = `gg-leaf-${uid}`;
  const sheenId = `gg-sheen-${uid}`;
  const clipId = `gg-blade-${uid}`;

  if (leafColor) {
    return (
      <svg viewBox="0 0 96 96" className={className} aria-hidden="true" focusable="false">
        <path d={BLADE} fill={leafColor} />
        <path d={PETIOLE} stroke={leafColor} strokeWidth="2" strokeLinecap="round" fill="none" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 96 96" className={className} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={gradId} x1="48" y1="14" x2="48" y2="62" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#fbe289" />
          <stop offset=".45" stopColor="#f2b83e" />
          <stop offset="1" stopColor="#d9822b" />
        </linearGradient>
        <radialGradient id={sheenId} cx="48" cy="30" r="30" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#fff3c4" stopOpacity=".55" />
          <stop offset="1" stopColor="#fff3c4" stopOpacity="0" />
        </radialGradient>
        <clipPath id={clipId}>
          <path d={BLADE} />
        </clipPath>
      </defs>
      <path d={BLADE} fill={`url(#${gradId})`} />
      <path d={BLADE} fill={`url(#${sheenId})`} />
      <g
        stroke="#fff6dd"
        strokeWidth=".62"
        strokeLinecap="round"
        opacity=".42"
        fill="none"
        clipPath={`url(#${clipId})`}
      >
        <path d={VEINS} />
      </g>
      <path d={PETIOLE} stroke="#c07a24" strokeWidth="2" strokeLinecap="round" fill="none" />
    </svg>
  );
}
