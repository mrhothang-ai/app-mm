const join = (...a) => a.filter(Boolean).join('/');
export default { join, resolve: join, dirname: p => String(p).split('/').slice(0, -1).join('/'), basename: p => String(p).split(/[\\/]/).pop() };
export { join };
