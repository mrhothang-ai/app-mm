// Quy tắc mật khẩu đăng nhập app: 8–64 ký tự, có cả chữ và số.
import { fail } from './db.mjs';
export const PASSWORD_RULE = 'Mật khẩu từ 8 ký tự, có cả chữ và số.';
export function checkPassword(p) {
  p = String(p ?? '');
  if (p.length < 8 || p.length > 64 || !/[A-Za-z]/.test(p) || !/\d/.test(p)) throw fail(PASSWORD_RULE);
  return p;
}
