'use client';
import { useState } from 'react';
import { Async, Button, ErrorBox, Notice, TextInput, useAction, useQuery } from '@utsavora/ui';
import { Shell } from '@/components/shell';

interface Commission {
  defaultBps: number;
  categories: { id: string; name: string; slug: string; bps: number | null }[];
  note: string;
}

function Form({ c, onSaved }: { c: Commission; onSaved: (c: Commission) => void }) {
  const [def, setDef] = useState(String(c.defaultBps / 100));
  const [cats, setCats] = useState<Record<string, string>>(Object.fromEntries(c.categories.map((x) => [x.id, x.bps == null ? '' : String(x.bps / 100)])));
  const [ok, setOk] = useState(false);
  const save = useAction((api, body: unknown) => api.put<Commission>('/admin/settings/commission', body));
  const pct = (s: string) => Math.round(Number(s) * 100);
  return (
    <div className="stack-lg" style={{ maxWidth: 640 }}>
      <Notice tone="info">{c.note}</Notice>
      <TextInput label="Default commission (%)" type="number" step="0.1" min={0} max={50} value={def} onChange={(e) => setDef(e.target.value)} />
      <fieldset className="stack">
        <legend>Category overrides (leave blank to use the default)</legend>
        {c.categories.map((x) => (
          <TextInput key={x.id} label={x.name} type="number" step="0.1" min={0} max={50} placeholder={def} value={cats[x.id]} onChange={(e) => setCats({ ...cats, [x.id]: e.target.value })} />
        ))}
      </fieldset>
      <ErrorBox error={save.error} />
      {ok && <Notice tone="success">Commission settings saved. New bookings use these rates.</Notice>}
      <div>
        <Button
          loading={save.pending}
          onClick={async () => {
            setOk(false);
            const r = await save.run({
              defaultBps: pct(def),
              categoryOverrides: Object.entries(cats).filter(([, v]) => v !== '').map(([categoryId, v]) => ({ categoryId, bps: pct(v) })),
            });
            if (r) { onSaved(r); setOk(true); }
          }}
        >
          Save commission settings
        </Button>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const q = useQuery('commission', (api) => api.get<Commission>('/admin/settings/commission'));
  return (
    <Shell title="Commission" intro="Platform fee taken from each booking. Vendor-specific rates can be added later.">
      <Async state={q}>{(c) => <Form c={c} onSaved={q.setData} />}</Async>
    </Shell>
  );
}
