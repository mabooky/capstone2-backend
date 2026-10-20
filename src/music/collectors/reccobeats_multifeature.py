"""Batch only unattempted feature work; retain legacy jobs, manifests and observations."""
import hashlib
import json
from urllib.parse import urlencode

from reccobeats_probe import BASE, spotify_id
from reccobeats_research import ResearchEngine, batch_candidates


class MultiFeatureEngine(ResearchEngine):
    def __init__(self, *args, feature_batch_size=40, **kwargs):
        if feature_batch_size not in (1,40):
            raise ValueError('Feature batch size must be 1 or 40')
        self.feature_batch_size=feature_batch_size
        super().__init__(*args, **kwargs)

    def next_feature_job(self):
        # Never regroup retries, completed work, or an existing batch. Reservations
        # and parent/member links are committed together, before any HTTP request.
        parent=self.db.execute("SELECT * FROM jobs WHERE stage='features' AND state='pending' "
            "AND key LIKE 'features:batch:%' ORDER BY next_at,key LIMIT 1").fetchone()
        if parent is not None:
            return parent
        job=super().next_feature_job()
        if (job is None or self.feature_batch_size==1 or job['attempts']
                or job['key'].startswith('features:batch:')):
            return job
        rows=self.db.execute("SELECT * FROM jobs WHERE stage='features' AND state='pending' "
            "AND attempts=0 AND key NOT LIKE 'features:batch:%' AND next_at<=? "
            "ORDER BY next_at,key LIMIT 40",(self.clock(),)).fetchall()
        if not rows:
            return job
        ids=[json.loads(row['ids'])[0] for row in rows]
        if any(len(json.loads(row['ids']))!=1 or row['key']!='features:'+sid
               for row,sid in zip(rows,ids)):
            raise ValueError('Unexpected legacy feature job')
        batch_candidates(self.cp,ids)
        key='features:batch:'+hashlib.sha256('\n'.join(ids).encode()).hexdigest()
        with self.db:
            self.db.execute('INSERT INTO jobs(key,stage,ids) VALUES(?,?,?)',(key,'features',json.dumps(ids)))
            for row in rows:
                self.db.execute("UPDATE jobs SET state='batched',reason=? WHERE key=?",
                    ('batch_member:'+key,row['key']))
                self.db.execute('INSERT INTO events(job_key,kind,detail) VALUES(?,?,?)',
                    (row['key'],'feature_batch_member',json.dumps({'parent':key})))
            self.cp.put('feature_batch_protocol','uuid-href-v1')
        return self.db.execute('SELECT * FROM jobs WHERE key=?',(key,)).fetchone()

    def request_url(self, job, ids):
        if job['key'].startswith('features:batch:'):
            candidates=batch_candidates(self.cp,ids)
            return BASE+'/audio-features?'+urlencode({'ids':','.join(c['uuid'] for c in candidates)})
        return super().request_url(job,ids)

    def process_features(self, job, ids, payload):
        if not job['key'].startswith('features:batch:'):
            return super().process_features(job,ids,payload)
        if not isinstance(payload,dict) or not isinstance(payload.get('content'),list):
            raise ValueError('Invalid batch envelope')
        candidates=batch_candidates(self.cp,ids)
        expected={c['uuid']:c['sid'] for c in candidates}
        returned={}
        # Validate the entire identity set before writing any score. Response order
        # never determines identity; duplicates and unexpected IDs fail atomically.
        for item in payload['content']:
            if not isinstance(item,dict):
                raise ValueError('Invalid batch item')
            internal=item.get('id')
            if (not isinstance(internal,str) or internal not in expected or internal in returned
                    or spotify_id(item.get('href'))!=expected[internal]):
                raise ValueError('Duplicate, foreign or conflicting batch identity')
            returned[internal]=item
        for c in candidates:
            if c['uuid'] in returned:
                self.features(c['sid'],returned[c['uuid']])
            else:
                # Not evidence of a 404. Terminal hold avoids automatic duplicate
                # requests until the provider's omission semantics are verified.
                self.db.execute("UPDATE candidates SET feature_outcome='held_batch_missing' WHERE sid=?",(c['sid'],))

    def job_finished(self, job, state):
        if job['key'].startswith('features:batch:') and state=='done':
            self.db.execute("UPDATE jobs SET state='done' WHERE state='batched' AND reason=?",
                ('batch_member:'+job['key'],))
