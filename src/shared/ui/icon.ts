export function outlineIcon(pathData: string): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(ns, 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('width', '20')
  svg.setAttribute('height', '20')
  svg.setAttribute('aria-hidden', 'true')
  const path = document.createElementNS(ns, 'path')
  path.setAttribute('d', pathData)
  path.setAttribute('fill', 'none')
  path.setAttribute('stroke', 'currentColor')
  path.setAttribute('stroke-width', '1.7')
  path.setAttribute('stroke-linecap', 'round')
  path.setAttribute('stroke-linejoin', 'round')
  svg.append(path)
  return svg
}
