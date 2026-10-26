// Same-value setters still enqueue DOM mutations and can replace text nodes.
export function setText(node: Node, value: string) {
  if (node.textContent !== value) node.textContent = value;
}

export function setAttribute(node: Element, name: string, value: string) {
  if (node.getAttribute(name) !== value) node.setAttribute(name, value);
}
