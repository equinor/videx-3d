export type SymbolData = Record<string, any>;

export type SymbolsType = {
  data?: SymbolData[];
  transformations: Float32Array;
  colors?: Float32Array;
};
