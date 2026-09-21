import type { Domain } from "@/types/event";
import { SPACE, swatchStyle, textStyle } from "./design";
import { DOMAIN_LABELS } from "./domain";

/*
 * ホバーの吹き出しの中身。地図（MapLibre の Popup）と年表で同じものを使う。
 * MapLibre の Popup は DOM 要素を受け取るので、React ではなく DOM で組み立てる。
 */

export interface PopupItem {
  readonly title: string;
  readonly domain: Domain;
  /** タイトルの後ろに添える注記（年表の「（地図に位置なし）」）。弱い文字色で出す */
  readonly note?: string;
}

const px = (value: number): string => `${value}px`;

/**
 * 吹き出しの中身。分類は色に頼らずテキストでも示す。
 * moreCount を渡すと、末尾に「ほか N 件」を足す（出す件数を絞ったとき）。heading は先頭の見出し（年表のヒストグラムの「1950年: 120件」）。
 */
export const popupContent = (
  items: readonly PopupItem[],
  moreCount: number = 0,
  heading: string | null = null,
): HTMLElement => {
  const root = document.createElement("div");
  Object.assign(root.style, { display: "flex", flexDirection: "column", gap: px(SPACE[8]) });
  if (heading !== null) {
    const headingEl = document.createElement("div");
    Object.assign(headingEl.style, {
      fontSize: px(textStyle.caption.fontSize),
      color: textStyle.caption.color,
      fontVariantNumeric: "tabular-nums",
    });
    headingEl.textContent = heading;
    root.append(headingEl);
  }
  items.forEach(({ title, domain, note }) => {
    const label = document.createElement("div");
    Object.assign(label.style, {
      display: "flex",
      alignItems: "center",
      gap: px(SPACE[4]),
      fontSize: px(textStyle.caption.fontSize),
      color: textStyle.caption.color,
    });
    const swatch = document.createElement("span");
    const swatchCss = swatchStyle(domain);
    Object.assign(swatch.style, {
      display: "inline-block",
      width: px(Number(swatchCss.width)),
      height: px(Number(swatchCss.height)),
      borderRadius: px(Number(swatchCss.borderRadius)),
      backgroundColor: String(swatchCss.backgroundColor),
    });
    const labelText = document.createElement("span");
    labelText.textContent = DOMAIN_LABELS[domain] ?? "";
    label.append(swatch, labelText);

    const titleEl = document.createElement("div");
    Object.assign(titleEl.style, {
      fontSize: px(textStyle.body.fontSize),
      color: textStyle.body.color,
    });
    titleEl.textContent = title;
    if (note !== undefined) {
      const noteEl = document.createElement("span");
      Object.assign(noteEl.style, { fontSize: px(textStyle.caption.fontSize), color: textStyle.caption.color });
      noteEl.textContent = note;
      titleEl.append(noteEl);
    }

    const item = document.createElement("div");
    item.append(label, titleEl);
    root.append(item);
  });
  if (moreCount > 0) {
    const more = document.createElement("div");
    Object.assign(more.style, { fontSize: px(textStyle.caption.fontSize), color: textStyle.caption.color });
    more.textContent = `ほか ${moreCount} 件`;
    root.append(more);
  }
  return root;
};
