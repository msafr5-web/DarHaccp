import { query } from '../config/database';
import type { DepartmentCode } from '../config/permissions';

export interface Department {
  id: number;
  code: DepartmentCode;
  name_ar: string;
  name_en: string;
}

// Departments are reference data: cache them in memory after the first load.
let cache: Department[] | null = null;

export async function listDepartments(): Promise<Department[]> {
  if (!cache) {
    const { rows } = await query<Department>('SELECT id, code, name_ar, name_en FROM departments ORDER BY id');
    cache = rows;
  }
  return cache;
}

export async function findDepartmentByCode(code: DepartmentCode): Promise<Department | undefined> {
  return (await listDepartments()).find((d) => d.code === code);
}
