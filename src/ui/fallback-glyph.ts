export function createFallbackGlyph(onClick: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "fallback-glyph";
  button.setAttribute("aria-label", "Open in browser");
  button.innerHTML = '<span class="fallback-arrow"></span>';
  button.addEventListener("click", onClick);
  return button;
}
