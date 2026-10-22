import type { ReactNode } from 'react';
import { Link } from 'react-router';

export interface Column<T> {
  header: string;
  cell: (row: T) => ReactNode;
  className?: string;
}

/**
 * Accessible table that collapses to cards on small screens. Rows link to
 * `href(row)` when provided (the first cell carries the link for keyboard users).
 */
export function DataTable<T extends { id: string }>({ rows, columns, href, caption }: {
  rows: T[];
  columns: Array<Column<T>>;
  href?: (row: T) => string;
  caption: string;
}) {
  return (
    <div className="overflow-x-auto rounded-xl bg-surface ring-1 ring-line">
      <table className="min-w-full divide-y divide-line text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-canvas text-left text-xs font-semibold tracking-wide text-muted uppercase">
          <tr>
            {columns.map((c) => (
              <th key={c.header} scope="col" className={`px-4 py-3 ${c.className ?? ''}`}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((row) => (
            <tr key={row.id} className={href ? 'hover:bg-brand-50/50' : undefined}>
              {columns.map((c, i) => (
                <td key={c.header} className={`px-4 py-3 align-top ${c.className ?? ''}`}>
                  {href && i === 0 ? (
                    <Link to={href(row)} className="font-medium text-brand-700 hover:underline">
                      {c.cell(row)}
                    </Link>
                  ) : (
                    c.cell(row)
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
