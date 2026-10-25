"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import { Bold, Italic, Plus, Table2 } from "lucide-react";
import { Button } from "@/components/ui/button";

type Sheet = { id: number; name: string; cells: string[][] };
const columns = ["A", "B", "C", "D", "E", "F", "G", "H"];
function blankCells() {
  return Array.from({ length: 24 }, () => columns.map(() => ""));
}
export type SpreadsheetValue = {
  sheets: Sheet[];
  styles: Record<string, { bold?: boolean; italic?: boolean }>;
};
export function blankSpreadsheet(): SpreadsheetValue {
  return { sheets: [{ id: 1, name: "Sheet 1", cells: blankCells() }], styles: {} };
}
export function RoomSpreadsheet({ value, onChange }: { value: SpreadsheetValue; onChange: (value: SpreadsheetValue) => void }) {
  const { sheets, styles } = value;
  const [activeSheet, setActiveSheet] = useState(sheets[0].id);
  const [selected, setSelected] = useState({ row: 0, col: 0 });
  function setSheets(update: (previous: Sheet[]) => Sheet[]) {
    onChange({ ...value, sheets: update(sheets) });
  }
  function setStyles(update: (previous: SpreadsheetValue['styles']) => SpreadsheetValue['styles']) {
    onChange({ ...value, styles: update(styles) });
  }
  const table = useRef<HTMLTableElement>(null);
  const sheet = sheets.find((item) => item.id === activeSheet)!;
  const address = `${columns[selected.col]}${selected.row + 1}`;
  const styleKey = `${activeSheet}:${selected.row}:${selected.col}`;
  function updateCell(row: number, col: number, value: string) {
    setSheets((previous) =>
      previous.map((item) =>
        item.id !== activeSheet
          ? item
          : {
              ...item,
              cells: item.cells.map((cells, index) =>
                index !== row
                  ? cells
                  : cells.map((cell, column) =>
                      column === col ? value : cell,
                    ),
              ),
            },
      ),
    );
  }
  function move(
    event: KeyboardEvent<HTMLInputElement>,
    row: number,
    col: number,
  ) {
    let nextRow = row;
    let nextCol = col;
    if (event.key === "Enter" || event.key === "ArrowDown") nextRow++;
    else if (event.key === "ArrowUp") nextRow--;
    else if (
      event.key === "ArrowLeft" &&
      event.currentTarget.selectionStart === 0
    )
      nextCol--;
    else if (
      event.key === "ArrowRight" &&
      event.currentTarget.selectionStart === event.currentTarget.value.length
    )
      nextCol++;
    else return;
    event.preventDefault();
    const target = table.current?.querySelector<HTMLInputElement>(
      `[data-cell="${Math.max(0, Math.min(sheet.cells.length - 1, nextRow))}-${Math.max(0, Math.min(7, nextCol))}"]`,
    );
    target?.focus();
    target?.select();
  }
  function toggleStyle(key: "bold" | "italic") {
    setStyles((previous) => ({
      ...previous,
      [styleKey]: { ...previous[styleKey], [key]: !previous[styleKey]?.[key] },
    }));
  }
  function addRow() {
    setSheets((previous) =>
      previous.map((item) =>
        item.id !== activeSheet
          ? item
          : { ...item, cells: [...item.cells, columns.map(() => "")] },
      ),
    );
  }
  function addSheet() {
    const id = Math.max(...sheets.map((item) => item.id)) + 1;
    setSheets((previous) => [
      ...previous,
      { id, name: `Sheet ${id}`, cells: blankCells() },
    ]);
    setActiveSheet(id);
    setSelected({ row: 0, col: 0 });
  }

  return (
    <div className="room-spreadsheet">
      <div className="room-panel-heading room-sheet-heading">
        <div>
          <Table2 size={16} />
          <h2>Spreadsheet</h2>
          <span className="room-document-status">Spreadsheet</span>
        </div>
        <span>Changes save with the document</span>
      </div>
      <div className="room-sheet-toolbar">
        <span className="room-sheet-font">
          Inter <span>11</span>
        </span>
        <span className="room-sheet-tool-divider" />
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Bold selected cell"
          aria-pressed={!!styles[styleKey]?.bold}
          onClick={() => toggleStyle("bold")}
        >
          <Bold size={14} />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Italic selected cell"
          aria-pressed={!!styles[styleKey]?.italic}
          onClick={() => toggleStyle("italic")}
        >
          <Italic size={14} />
        </Button>
        <span className="room-sheet-tool-divider" />
        <Button variant="ghost" size="sm" onClick={addRow}>
          <Plus size={13} />
          Add row
        </Button>
        <span className="room-sheet-editing">Editing</span>
      </div>
      <div className="room-sheet-value-bar">
        <span className="room-sheet-address" aria-label="Selected cell">
          {address}
        </span>
        <span className="room-sheet-fx" aria-hidden="true">
          fx
        </span>
        <input
          maxLength={10000}
          aria-label={`Value of ${address}`}
          value={sheet.cells[selected.row]?.[selected.col] ?? ""}
          onChange={(event) =>
            updateCell(selected.row, selected.col, event.target.value)
          }
          placeholder="Enter a cell value…"
        />
      </div>
      <div className="room-sheet-grid-scroll">
        <table
          ref={table}
          className="room-sheet-grid"
          aria-label={`${sheet.name} spreadsheet`}
        >
          <thead>
            <tr>
              <th aria-label="Row numbers" />
              {columns.map((column, index) => (
                <th
                  key={column}
                  scope="col"
                  className={selected.col === index ? "is-selected" : ""}
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sheet.cells.map((row, rowIndex) => (
              <tr key={rowIndex}>
                <th
                  scope="row"
                  className={selected.row === rowIndex ? "is-selected" : ""}
                >
                  {rowIndex + 1}
                </th>
                {row.map((value, colIndex) => {
                  const cellStyle =
                    styles[`${activeSheet}:${rowIndex}:${colIndex}`];
                  return (
                    <td
                      key={colIndex}
                      className={`${rowIndex === 0 ? "is-header" : ""} ${selected.row === rowIndex && selected.col === colIndex ? "is-active" : ""}`}
                    >
                      <input
          maxLength={10000}
                        data-cell={`${rowIndex}-${colIndex}`}
                        aria-label={`Cell ${columns[colIndex]}${rowIndex + 1}`}
                        value={value}
                        onFocus={() =>
                          setSelected({ row: rowIndex, col: colIndex })
                        }
                        onChange={(event) =>
                          updateCell(rowIndex, colIndex, event.target.value)
                        }
                        onKeyDown={(event) => move(event, rowIndex, colIndex)}
                        style={{
                          fontWeight: cellStyle?.bold ? 650 : undefined,
                          fontStyle: cellStyle?.italic ? "italic" : undefined,
                        }}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="room-sheet-bottom">
        <div
          className="room-sheet-tabs"
          role="group"
          aria-label="Workbook sheets"
        >
          {sheets.map((item) => (
            <Button variant="ghost" size="sm"
              key={item.id}
              aria-pressed={item.id === activeSheet}
              onClick={() => {
                setActiveSheet(item.id);
                setSelected({ row: 0, col: 0 });
              }}
            >
              <Table2 size={12} />
              {item.name}
            </Button>
          ))}
          <Button variant="ghost" size="sm" aria-label="Add sheet" onClick={addSheet}>
            <Plus size={15} />
          </Button>
        </div>
        <span>{sheet.cells.length} rows · 8 columns</span>
      </div>
      <p className="room-sheet-note">
        Save to keep workbook changes · formula calculation is not connected.
      </p>
    </div>
  );
}
