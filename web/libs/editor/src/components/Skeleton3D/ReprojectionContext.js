import { createContext } from "react";

// Pure presentation state shared between the stable App toolbar and the 2D
// Konva stage. Never stored in an annotation, task payload or project config.
export const ReprojectionContext = createContext(null);
