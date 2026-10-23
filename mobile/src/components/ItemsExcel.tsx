import { ExcelSync } from './ExcelSync';

/** Item master ⇄ Excel (export, blank template, bulk import / update with preview). */
export function ItemsExcel({ canImport, onImported }: { canImport: boolean; onImported: () => void }) {
  const date = new Date().toISOString().slice(0, 10);
  return (
    <ExcelSync
      intro="صدّر الأصناف، عدّلها أو أضف إليها في Excel، ثم استوردها لتحديث الجدول دفعة واحدة. يُعرض ملخص التغييرات قبل التطبيق."
      exportPath="/items/export.xlsx" exportName={`الأصناف-${date}.xlsx`} templateName="قالب-الأصناف.xlsx" importPath="/items/import"
      canImport={canImport} onImported={onImported}
      describe={(c) => {
        const changes = c.changes as string[] | undefined;
        return `${String(c.code)} — ${String(c.name_ar)}${changes?.length ? ` (${changes.join('، ')})` : ''}`;
      }}
    />
  );
}
