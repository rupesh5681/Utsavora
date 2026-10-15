import { parseConnectionString, SqlServerTypesPlugin } from './client';
import { splitBatches } from './migrate';

describe('parseConnectionString', () => {
  it('reads an ADO.NET connection string', () => {
    expect(parseConnectionString('Server=tcp:db.example.com,1444;Database=utsavora;User Id=app;Password=p;w=d;Encrypt=true;TrustServerCertificate=false')).toEqual({
      server: 'db.example.com',
      port: 1444,
      instanceName: undefined,
      database: 'utsavora',
      user: 'app',
      password: 'p',
      encrypt: true,
      trustServerCertificate: false,
    });
  });

  it('supports named instances, aliases and local defaults', () => {
    const c = parseConnectionString('Data Source=.\\SQLEXPRESS;Initial Catalog=utsavora;UID=sa;PWD=x;TrustServerCertificate=yes');
    expect(c).toMatchObject({ server: 'localhost', instanceName: 'SQLEXPRESS', port: undefined, database: 'utsavora', user: 'sa', password: 'x', encrypt: true, trustServerCertificate: true });
  });

  it('requires a database and SQL login', () => {
    expect(() => parseConnectionString('Server=localhost;User Id=sa;Password=x')).toThrow(/Database/);
    expect(() => parseConnectionString('Server=localhost;Database=x')).toThrow(/User Id/);
  });
});

describe('splitBatches', () => {
  it('splits on GO lines like SSMS and drops empty batches', () => {
    expect(splitBatches('CREATE TABLE a (x INT);\nGO\n\ngo -- next\nCREATE INDEX i ON a (x);\nGO\n')).toEqual(['CREATE TABLE a (x INT);', 'CREATE INDEX i ON a (x);']);
    expect(splitBatches('SELECT 1 AS GOAL;')).toEqual(['SELECT 1 AS GOAL;']);
  });
});

describe('SqlServerTypesPlugin', () => {
  it('turns DATE values into YYYY-MM-DD and parses JSON columns', async () => {
    const rows = [{ eventDate: new Date('2026-11-03T00:00:00Z'), createdAt: new Date('2026-11-03T00:00:00Z'), inclusions: '["a","b"]', snapshot: '{"x":1}', title: '["not json col"]' }];
    await new SqlServerTypesPlugin().transformResult({ queryId: { queryId: '1' }, result: { rows } } as never);
    expect(rows[0]).toEqual({ eventDate: '2026-11-03', createdAt: new Date('2026-11-03T00:00:00Z'), inclusions: ['a', 'b'], snapshot: { x: 1 }, title: '["not json col"]' });
  });
});
