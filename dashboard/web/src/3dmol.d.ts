/**
 * 3Dmol ships types for its own source tree, not for the prebuilt ES6 bundle we import, so the
 * bundle path needs a declaration. Only the members the site actually calls are declared, which
 * keeps the surface honest: anything else is a compile error rather than a silent `any`.
 */
declare module '3dmol/build/3Dmol.es6-min.js' {
  export interface GLViewer {
    addModel(data: string, format: string): unknown;
    getModel(): { selectedAtoms(sel: object): { atom: string; resi: number | string }[] };
    setStyle(selector: object, style: object): void;
    addStyle(selector: object, style: object): void;
    render(): void;
    zoomTo(): void;
    clear(): void;
  }
  export function createViewer(element: HTMLElement, config?: object): GLViewer;
}
