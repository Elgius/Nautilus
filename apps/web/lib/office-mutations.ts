// Sheets use internal document units for their cell and formula editors.
// Those updates do not change the room's document/workbook snapshot.
export function belongsToOfficeUnit(params: object | undefined, unitId: string): boolean {
  return !params || !('unitId' in params) || params.unitId === unitId;
}
