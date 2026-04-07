export interface ColumnDef {
  key: string;
  label: string;
  minWidth: number;
  defaultFlex: number;
  fixedWidth?: number;
}

export interface ColumnState {
  key: string;
  width: number;
}
