import {
  mapKonvaBrightness,
  reverseCoordinates,
  fixRectToFit,
  getBoundingBoxAfterTransform,
  getBoundingBoxAfterChanges,
  getActualZoomingPosition,
  getTransformedImageData,
  createDragBoundFunc,
} from "../image";

describe("mapKonvaBrightness", () => {
  describe("linear range (0% - 100%)", () => {
    it.each([
      [0, -1],
      [25, -0.75],
      [50, -0.5],
      [75, -0.25],
      [100, 0],
    ])("maps %d%% brightness to %f", (input, expected) => {
      expect(mapKonvaBrightness(input)).toBeCloseTo(expected, 4);
    });
  });

  describe("non-linear range (100% - 400%)", () => {
    it.each([
      [150, Math.sqrt(50 / 300) * 0.8],
      [200, Math.sqrt(100 / 300) * 0.8],
      [250, Math.sqrt(150 / 300) * 0.8],
      [300, Math.sqrt(200 / 300) * 0.8],
      [350, Math.sqrt(250 / 300) * 0.8],
      [400, Math.sqrt(300 / 300) * 0.8], // = 0.8
    ])("maps %d%% brightness correctly", (input, expected) => {
      expect(mapKonvaBrightness(input)).toBeCloseTo(expected, 4);
    });
  });

  describe("general characteristics", () => {
    it("returns a finite number for a wide range of inputs", () => {
      for (let i = 0; i <= 400; i += 10) {
        const result = mapKonvaBrightness(i);
        expect(typeof result).toBe("number");
        expect(Number.isFinite(result)).toBe(true);
      }
    });

    it("returns 0 at exactly 100%", () => {
      expect(mapKonvaBrightness(100)).toBe(0);
    });

    it("returns maximum value 0.8 at 400%", () => {
      expect(mapKonvaBrightness(400)).toBeCloseTo(0.8, 4);
    });
  });
});

describe("reverseCoordinates", () => {
  it("normalizes so x1 <= x2 and y1 <= y2", () => {
    const r = reverseCoordinates({ x: 10, y: 20 }, { x: 5, y: 15 });
    expect(r.x1).toBe(5);
    expect(r.y1).toBe(15);
    expect(r.x2).toBe(10);
    expect(r.y2).toBe(20);
  });
  it("swaps when first point is right/below second", () => {
    const r = reverseCoordinates({ x: 5, y: 15 }, { x: 10, y: 20 });
    expect(r.x1).toBe(5);
    expect(r.y1).toBe(15);
    expect(r.x2).toBe(10);
    expect(r.y2).toBe(20);
  });
});

describe("fixRectToFit", () => {
  it("clips rect that extends past stage right/bottom", () => {
    const rect = { x: 0, y: 0, width: 150, height: 120 };
    const result = fixRectToFit(rect, 100, 100);
    expect(result.width).toBe(100);
    expect(result.height).toBe(100);
  });
  it("clips rect with negative x/y", () => {
    const rect = { x: -10, y: -5, width: 50, height: 50 };
    const result = fixRectToFit(rect, 100, 100);
    expect(result.x).toBe(0);
    expect(result.y).toBe(0);
    expect(result.width).toBe(40);
    expect(result.height).toBe(45);
  });
  it("returns rect unchanged when already inside", () => {
    const rect = { x: 10, y: 10, width: 50, height: 50 };
    const result = fixRectToFit(rect, 100, 100);
    expect(result).toEqual({ ...rect, x: 10, y: 10, width: 50, height: 50 });
  });
});

describe("getBoundingBoxAfterTransform", () => {
  it("returns bounding box of rect corners after transform", () => {
    const rect = { x: 0, y: 0, width: 10, height: 20 };
    const transform = {
      point: (p) => ({ x: p.x + 5, y: p.y + 10 }),
    };
    const result = getBoundingBoxAfterTransform(rect, transform);
    expect(result).toEqual({ x: 5, y: 10, width: 10, height: 20 });
  });
});

describe("getBoundingBoxAfterChanges", () => {
  it("applies translate and rotate then returns bounding box", () => {
    const rect = { x: 0, y: 0, width: 10, height: 10 };
    const shiftPoint = { x: 0, y: 0 };
    const result = getBoundingBoxAfterChanges(rect, shiftPoint, 0);
    expect(result).toHaveProperty("x", 0);
    expect(result).toHaveProperty("y", 0);
    expect(result).toHaveProperty("width", 10);
    expect(result).toHaveProperty("height", 10);
  });
});

describe("getActualZoomingPosition", () => {
  it("converts zoom position to natural image coordinates", () => {
    const [x, y] = getActualZoomingPosition(100, 50, 200, 100, 20, 10);
    expect(x).toBe(10);
    expect(y).toBe(5);
  });
});

describe("getTransformedImageData", () => {
  const createMockCanvas = () => {
    const imageData = { data: new Uint8ClampedArray(4) };
    return {
      width: 10,
      height: 10,
      getContext: () => ({
        drawImage: jest.fn(),
        getImageData: () => imageData,
      }),
    };
  };

  beforeEach(() => {
    const createElement = document.createElement.bind(document);
    jest.spyOn(document, "createElement").mockImplementation((tagName) => {
      if (tagName === "canvas") return createMockCanvas();
      return createElement(tagName);
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("uses negativezoom branch for canvas size and viewport natural dimensions", () => {
    const img = {};
    const [data, canvas] = getTransformedImageData(img, 100, 50, 80, 40, 60, 30, 1, 0, 0, true);
    expect(data).toBeDefined();
    expect(canvas).toBeDefined();
    expect(canvas.width).toBe(60);
    expect(canvas.height).toBe(30);
  });

  it("uses non-negative zoom branch for canvas and viewport dimensions", () => {
    const img = {};
    const [data, canvas] = getTransformedImageData(img, 100, 50, 200, 100, 150, 75, 1, 0, 0, false);
    expect(data).toBeDefined();
    expect(canvas).toBeDefined();
    expect(canvas.width).toBe(150);
    expect(canvas.height).toBe(75);
  });

  it("throws when getImageData fails (CORS)", () => {
    const createElement = document.createElement.bind(document);
    jest.spyOn(document, "createElement").mockImplementation((tagName) => {
      if (tagName === "canvas") {
        return {
          width: 10,
          height: 10,
          getContext: () => ({
            drawImage: jest.fn(),
            getImageData: () => {
              throw new Error("CORS");
            },
          }),
        };
      }
      return createElement(tagName);
    });
    const alertSpy = jest.spyOn(global, "alert").mockImplementation(() => {});
    const consoleSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    expect(() => getTransformedImageData({}, 10, 10, 10, 10, 10, 10, 1, 0, 0, false)).toThrow(
      "Please configure CORS cross-domain headers correctly",
    );

    alertSpy.mockRestore();
    consoleSpy.mockRestore();
    jest.restoreAllMocks();
  });
});

describe("KeyPointRegion edge dragging", () => {
  const image = {
    fixForZoomWrapper: (pos, fn) => fn(pos),
    canvasToInternalX: (x) => x / 2,
    canvasToInternalY: (y) => y / 2,
    internalToCanvasX: (x) => x * 2,
    internalToCanvasY: (y) => y * 2,
    selectedRegionsBBox: null,
  };

  it.each([
    [{ x: -20, y: -30 }, { x: 0, y: 0 }],
    [{ x: 220, y: 240 }, { x: 200, y: 200 }],
    [{ x: 1, y: 199 }, { x: 1, y: 199 }],
    [{ x: 100, y: 100 }, { x: 100, y: 100 }],
  ])("allows point centre to reach the whole image: %p", (position, expected) => {
    const item = {
      type: "keypointregion",
      parent: image,
      selected: true,
      inSelection: false,
      bboxCoords: { left: 47, top: 47, right: 53, bottom: 53 },
    };
    expect(createDragBoundFunc(item)(position)).toEqual(expected);
  });

  it("preserves rectangle restriction for multi-region selection drags", () => {
    const item = {
      type: "keypointregion",
      parent: {
        ...image,
        selectedRegionsBBox: { left: 30, top: 30, right: 60, bottom: 60 },
      },
      selected: false,
      inSelection: true,
      bboxCoords: { left: 45, top: 45, right: 55, bottom: 55 },
    };
    // The selected group is still constrained by its overall bbox.
    const result = createDragBoundFunc(item)({ x: 200, y: 200 });
    expect(result.x).toBeLessThan(200);
    expect(result.y).toBeLessThan(200);
  });
});

describe("createDragBoundFunc", () => {
  it("returns a function that applies offset and fixRectToFit via fixForZoomWrapper", () => {
    const image = {
      fixForZoomWrapper: (pos, fn) => fn(pos),
      canvasToInternalX: (x) => x,
      canvasToInternalY: (y) => y,
      internalToCanvasX: (x) => x,
      internalToCanvasY: (y) => y,
      selectedRegionsBBox: null,
    };
    const item = {
      parent: image,
      selected: true,
      inSelection: false,
      bboxCoords: { top: 0, left: 0, right: 120, bottom: 40 },
    };
    const bound = createDragBoundFunc(item, { x: 0, y: 0 });
    const result = bound({ x: 20, y: 30 });
    expect(result).toHaveProperty("x");
    expect(result).toHaveProperty("y");
  });
});
