/**
 * This class makes it easier to worked with typed arrray used in a 2d grid.
 * It allow you to read from and write to a flat typed array using columns, rows
 * and blocks. It alow you to specify the stride per grid cell, so if you need
 * a grid og RGB colors, you set the stride to 3.
 *
 * Another useful feature of this class is that it will use bilinear interpolation
 * if you reference columns and/or rows with decimal indexes.
 *
 * @author Kjerand Pedersen
 */

export type TypedArrayArrayType =
  | Float32Array
  | Uint8Array
  | Uint16Array
  | Uint32Array;

export type TypedArrayOutputArray = TypedArrayArrayType | undefined;

export type TypedArrayInputArray = number[];

export type TypedArrayMapFunction = (
  input: number | TypedArrayArrayType,
) => number | TypedArrayArrayType;

export type InterpolationFunction = (
  a: number,
  b: number,
  c: number,
  d: number,
  t1: number,
  t2: number,
) => number;

export class Typed2DArray {
  data: TypedArrayArrayType;
  columns: number;
  rows: number;
  stride: number;
  private _rowLength: number;
  private _lerpFn: InterpolationFunction[] = [];
  private arrayConstructor: (size: number) => TypedArrayArrayType;

  constructor(data: TypedArrayArrayType, columns: number, stride: number = 1) {
    this.data = data;
    this.columns = columns;
    this.stride = stride;
    this._rowLength = columns * stride;
    this.rows = this.data.length / this._rowLength;
    this.arrayConstructor = (size: number) =>
      new (this.data.constructor as new (n: number) => TypedArrayArrayType)(
        size,
      ) as TypedArrayArrayType;
  }

  static readWriteBlock(
    source: Typed2DArray,
    sourceCol: number,
    sourceRow: number,
    sourceColumns: number,
    sourceRows: number,
    target: Typed2DArray,
    targetCol: number,
    targetRow: number,
    targetColumns: number,
    targetRows: number,
    mapFunction: TypedArrayMapFunction | null = null,
  ) {
    if (!(source instanceof Typed2DArray && target instanceof Typed2DArray)) {
      throw Error('Source and target must be of type Typed2dArray');
    }

    if (
      targetCol < 0 ||
      targetCol + targetColumns > target.columns ||
      targetRow < 0 ||
      targetRow + targetRows > target.rows
    ) {
      throw Error('Invalid target block dimensions!');
    }
    if (
      sourceCol < 0 ||
      sourceCol + sourceColumns > source.columns ||
      sourceRow < 0 ||
      sourceRow + sourceRows > source.rows
    ) {
      throw Error('Invalid source block dimensions!');
    }

    const tcd = Math.max(1, targetColumns - 1);
    const trd = Math.max(1, targetRows - 1);

    const scd = Math.max(1, sourceColumns - 1);
    const srd = Math.max(1, sourceRows - 1);

    for (let r = 0; r < targetRows; r++) {
      const ri = target.index(0, r + targetRow);
      const fractRow = (r / trd) * srd + sourceRow;
      for (let c = 0; c < targetColumns; c++) {
        const targetIdx = ri + (c + targetCol) * target.stride;
        const fractCol = (c / tcd) * scd + sourceCol;
        let sourceValue = source.valueAt(fractCol, fractRow);
        if (mapFunction) {
          sourceValue = mapFunction(sourceValue);
        }
        if (target.stride === 1) {
          target.data[targetIdx] = sourceValue as number;
        } else if (Array.isArray(sourceValue)) {
          for (let j = 0; j < sourceValue.length; j++) {
            target.data[targetIdx + j] = sourceValue[j];
          }
        }
      }
    }

    return this;
  }

  // built-in interpolation methods
  static logInterp(
    a: number,
    b: number,
    c: number,
    d: number,
    t1: number,
    t2: number,
  ) {
    const v1 = (b * b - a * a) * t1 + a * a;
    const v2 = (d * d - c * c) * t1 + c * c;
    //console.log('log')
    return Math.sqrt((v2 - v1) * t2 + v1);
  }

  static linearInterp(
    a: number,
    b: number,
    c: number,
    d: number,
    t1: number,
    t2: number,
  ) {
    const v1 = (b - a) * t1 + a;
    const v2 = (d - c) * t1 + c;
    //console.log('linear')
    return (v2 - v1) * t2 + v1;
  }

  static nearestInterp(
    a: number,
    b: number,
    c: number,
    d: number,
    t1: number,
    t2: number,
  ) {
    const v1 = t1 <= 0.5 ? a : b;
    const v2 = t1 <= 0.5 ? c : d;
    return t2 <= 0.5 ? v1 : v2;
  }

  // // create a new Typed2DArray instance using an existing data array
  // static from<ArrayType>(source: ArrayType, columns: number, stride = 1, copyData = false) {
  //   const data = source instanceof Typed2DArray ? source.data : source;
  //   const array = new Typed2DArray(data.constructor, columns,  data.length / (columns * stride), stride, false);
  //   array.data = copyData ? new array.type(data) : data;
  //   if (source instanceof Typed2DArray) {
  //     array.setInterpolator(...source._lerpFn);
  //   }
  //   return array;
  // }

  // alias for columns
  get width() {
    return this.columns;
  }
  // alias for rows
  get height() {
    return this.rows;
  }

  // get the array index to the first component from the provided column and row indices
  index(col: number, row: number): number {
    if (col < 0 || row < 0 || col >= this.columns || row >= this.rows)
      throw Error('Index out of bounds!');
    return row * this._rowLength + col * this.stride;
  }

  // get the column and row at the beginning of the item according to stride from an index into the data array
  positionOf(index: number) {
    if (index < 0 || index > this.data.length) return undefined;
    const offset = index % this.stride;
    const row = Math.floor((index - offset) / this._rowLength);
    const col = Math.floor((index - row * this._rowLength) / this.stride);
    return { row, col };
  }

  // allow you to set a custom interpolation function per component, which are used when interpolating values
  setInterpolator(...interpolatorFunction: InterpolationFunction[]) {
    this._lerpFn = interpolatorFunction;
    return this;
  }

  // get the configured interpolation function for the given component index
  getInterpolator(component: number) {
    if (this._lerpFn.length > 0) {
      return this._lerpFn[Math.min(component, this._lerpFn.length - 1)];
    }
    return Typed2DArray.linearInterp;
  }

  // convenience function for reading an entire column
  col(col: number, out: TypedArrayOutputArray) {
    return this.readBlock(
      Math.floor(col),
      0,
      1,
      this.rows,
      undefined,
      undefined,
      out,
    );
  }

  // convenience function for reading an entire row
  row(row: number, out: TypedArrayOutputArray) {
    const from = this.index(0, Math.floor(row));

    if (out) {
      for (let i = 0; i < this._rowLength; i++) {
        out[i] = this.data[from + i];
      }
      return out;
    }
    return this.data.subarray(from, from + this._rowLength);
  }

  // set a single value into the provided column and row
  setValue(col: number, row: number, ...value: TypedArrayInputArray) {
    const i = this.index(col, row);

    for (let j = 0; j < Math.min(value.length, this.stride); j++) {
      this.data[i + j] = value[j];
    }
    return this;
  }

  // read all the values within the provided block dimension
  readBlock(
    fromCol: number,
    fromRow: number,
    columns: number,
    rows: number,
    targetColumns?: number,
    targetRows?: number,
    out?: TypedArrayOutputArray,
  ) {
    if (
      fromCol < 0 ||
      fromCol + columns > this.columns ||
      fromRow < 0 ||
      fromRow + rows > this.rows
    )
      throw Error('Invalid block dimensions!');

    targetColumns = (Number.isFinite(targetColumns) ? targetColumns : columns)!;
    targetRows = (Number.isFinite(targetRows) ? targetRows : rows)!;

    out =
      out || this.arrayConstructor(targetColumns * targetRows * this.stride);

    const tcd = Math.max(1, targetColumns - 1);
    const trd = Math.max(1, targetRows - 1);

    const scd = Math.max(1, columns - 1);
    const srd = Math.max(1, rows - 1);

    let i = 0;
    for (let r = 0; r < targetRows; r++) {
      const fractRow = (r / trd) * srd + fromRow;
      for (let c = 0; c < targetColumns; c++) {
        const fractCol = (c / tcd) * scd + fromCol;
        const value = this.valueAt(fractCol, fractRow);
        if (this.stride === 1) {
          out[i++] = value as number;
        } else if (Array.isArray(value)) {
          for (let j = 0; j < value.length; j++) {
            out[i++] = value[j];
          }
        }
      }
    }
    return out;
  }

  // upscale grid using the current interpolation method
  upscale(newColumns: number, newRows: number) {
    if (newColumns < this.columns || newRows < this.rows)
      throw Error(
        'New column and row size must be equal or bigger than the current sizes!',
      );
    const scaled = this.readBlock(
      0,
      0,
      this.columns,
      this.rows,
      newColumns,
      newRows,
    );

    this.columns = newColumns;
    this.rows = newRows;
    this._rowLength = newColumns * this.stride;
    this.data = scaled;

    return this;
  }

  // write values into a given block dimension
  writeBlock(
    fromCol: number,
    fromRow: number,
    columns: number,
    rows: number,
    values: number[],
  ) {
    if (values.length !== columns * rows * this.stride)
      throw Error('Incorrect number of values');
    if (
      fromCol < 0 ||
      fromCol + columns > this.columns ||
      fromRow < 0 ||
      fromRow + rows > this.rows
    )
      throw Error('Invalid block dimensions!');

    let k = 0;
    for (let r = fromRow; r < fromRow + rows; r++) {
      const ri = this.index(fromCol, r);
      for (let c = 0; c < columns; c++) {
        const i = ri + c * this.stride;
        for (let j = 0; j < this.stride; j++) {
          this.data[i + j] = values[k++];
        }
      }
    }
    return this;
  }

  // fills the block with a single value
  fillBlock(
    fromCol: number,
    fromRow: number,
    cols: number,
    rows: number,
    value: number | ((c: number, r: number, i: number) => number | number[]),
  ) {
    if (
      fromCol < 0 ||
      fromCol + cols > this.columns ||
      fromRow < 0 ||
      fromRow + rows > this.rows
    )
      throw Error('Invalid block dimensions!');

    let setValue = (_c: number, _r: number, i: number) => {
      this.data[i] = value as number;
    };
    if (typeof value === 'function') {
      setValue = (c, r, i) => {
        const res = value(c, r, i);
        if (Array.isArray(res) && res.length && res.length > 0) {
          for (let n = 0; n < Math.min(res.length, this.stride); n++) {
            this.data[i + n] = res[n];
          }
        } else {
          this.data[i] = res as number;
        }
      };
    } else if (this.stride > 1 && Array.isArray(value)) {
      setValue = (_c, _r, i) => {
        for (let j = 0; j < Math.min(value.length, this.stride); j++) {
          this.data[i + j] = value[j];
        }
      };
    }

    for (let r = fromRow; r < fromRow + rows; r++) {
      const ri = this.index(fromCol, r);
      for (let c = 0; c < cols; c++) {
        const i = ri + c * this.stride;
        setValue(c, r, i);
      }
    }
    return this;
  }

  // get the value corresponding to the specified index according to stride
  valueOf(index: number, out?: TypedArrayOutputArray) {
    const { stride, data: d } = this;
    if (stride > 1) {
      index = index % stride;
      out = out || this.arrayConstructor(stride);
      for (let j = 0; j < stride; j++) {
        out[j] = d[index + j];
      }
      return out;
    }
    return d[index];
  }

  // get the calue at the requested column and row, which may be given as fractions, which in case
  // bilinear filtering will be applied to interpolate values (for each component) in between columns and rows
  valueAt(col: number, row: number, out?: TypedArrayOutputArray) {
    const { columns, rows, stride, data: d } = this;

    const cpos = col % 1;
    const rpos = row % 1;

    // if fractional col or row is requested we need to use bilinear interpolation
    if (cpos > 0 || rpos > 0) {
      // clamp and floor coordinate
      const c1 = (col < 0 ? 0 : col >= columns ? columns - 1 : col) | 0;
      const r1 = (row < 0 ? 0 : row >= rows ? rows - 1 : row) | 0;
      // get next data pos
      const c2 = c1 === columns - 1 ? c1 : c1 + 1;
      const r2 = r1 === rows - 1 ? r1 : r1 + 1;

      // get data indices
      let i1 = this.index(c1, r1);
      let i2 = this.index(c2, r1);
      let i3 = this.index(c1, r2);
      let i4 = this.index(c2, r2);

      if (stride > 1) {
        // interpolate
        out = out || this.arrayConstructor(stride);
        for (let i = 0; i < stride; i++) {
          const lerp = this.getInterpolator(i);
          out[i] = lerp(d[i1++], d[i2++], d[i3++], d[i4++], cpos, rpos);
        }
        return out;
      }
      const lerp = this.getInterpolator(0);
      return lerp(d[i1], d[i2], d[i3], d[i4], cpos, rpos);
    }

    // simple lookup
    const i = this.index(col, row);
    if (stride > 1) {
      out = out || this.arrayConstructor(stride);
      for (let j = 0; j < stride; j++) {
        out[j] = d[i + j];
      }
      return out;
    }
    return d[i];
  }

  // swap all values from one row with all values from another row
  swapRows(r1: number, r2: number, temp: TypedArrayArrayType) {
    temp = temp || this.arrayConstructor(this._rowLength);
    this.row(r1, temp);
    const i1 = this.index(0, r1);
    const i2 = this.index(0, r2);
    for (let c = 0; c < this._rowLength; c++) {
      this.data[i1 + c] = this.data[i2 + c];
      this.data[i2 + c] = temp[c];
    }
    return this;
  }

  // invert all rows (top-bottom to bottom-top)
  invertRows() {
    const rowsToFlip = Math.floor(this.rows / 2);
    const temp = this.arrayConstructor(this._rowLength);
    for (let rb = this.rows - 1, rt = 0; rb > rowsToFlip; rb--, rt++) {
      this.swapRows(rb, rt, temp);
    }
    return this;
  }

  copyInto(
    target: TypedArrayArrayType,
    fromCol = 0,
    fromRow = 0,
    columns = this.columns - fromCol,
    rows = this.rows - fromRow,
  ) {
    if (target.length !== columns * rows * this.stride)
      throw Error('Target is not of the correct size!');

    let k = 0;
    for (let r = fromRow; r < fromRow + rows; r++) {
      const ri = this.index(0, r);
      for (let c = fromCol; c < fromCol + columns; c++) {
        const i = ri + c * this.stride;
        for (let j = 0; j < this.stride; j++) {
          target[k++] = this.data[i + j];
        }
      }
    }
    return this;
  }

  // return a multi-dimensional javascript array of the data (main purpose for debugging)
  toJsArray() {
    const arr = new Array(this.rows);

    for (let r = 0; r < this.rows; r++) {
      const ri = this.index(0, r);
      arr[r] = new Array(this.columns);
      for (let c = 0; c < this.columns; c++) {
        if (this.stride > 1) {
          arr[r][c] = new Array(this.stride);
          for (let j = 0; j < this.stride; j++) {
            arr[r][c][j] = this.data[ri + c * this.stride + j];
          }
        } else {
          arr[r][c] = this.data[ri + c * this.stride];
        }
      }
    }
    return arr;
  }
}
