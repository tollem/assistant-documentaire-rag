import base64
import io
import json
import os
from pathlib import Path
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from unittest.mock import patch

import app


class RagTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.patch = patch.object(app, 'DATA', Path(self.temp.name))
        self.patch.start()
        self.env = patch.dict(os.environ, {'GCS_BUCKET': ''})
        self.env.start()

    def tearDown(self):
        self.env.stop()
        self.patch.stop()
        self.temp.cleanup()

    def test_ingest_dedup_retrieve_delete(self):
        content = 'Le budget Atlas est de 500 CHF. Léa Martin pilote le projet.'.encode()
        self.assertFalse(app.ingest('budget.md', content, False)['duplicate'])
        self.assertTrue(app.ingest('copie.md', content, False)['duplicate'])
        result = app.answer('Quel est le budget Atlas ?', False)
        self.assertIn('500 CHF', result['answer'])
        self.assertEqual(result['sources'][0]['page'], 1)
        self.assertFalse(result['verified'])
        with app.db() as conn:
            conn.execute('DELETE FROM documents')
        self.assertEqual(app.retrieve('budget Atlas', False), [])

    def test_unknown_question_abstains_without_model(self):
        app.ingest('note.txt', b'Atlas centralise les supports pedagogiques.', False)
        self.assertEqual(app.answer('recette lasagne vegetarienne', False)['sources'], [])

    def test_chunking_covers_end_and_overlaps(self):
        text = 'abcdefghij' * 400
        chunks = app.split_text(text)
        self.assertTrue(all(len(c) <= 1200 for c in chunks))
        self.assertTrue(chunks[0].endswith(chunks[1][:180]))
        self.assertTrue(text.endswith(chunks[-1]))

    def test_invalid_inputs(self):
        for name, content in [('x.md', b''), ('x.exe', b'abc'), ('x.txt', b'\xff')]:
            with self.assertRaises(ValueError):
                app.ingest(name, content, False)
        for question in [None, '', 'ab', 'x' * 2001]:
            with self.assertRaises(ValueError):
                app.answer(question, False)

    def test_pdf_pages_and_no_text(self):
        from pypdf import PdfWriter
        writer = PdfWriter()
        writer.add_blank_page(width=200, height=200)
        buffer = io.BytesIO()
        writer.write(buffer)
        with self.assertRaisesRegex(ValueError, 'Aucun texte'):
            app.ingest('scan.pdf', buffer.getvalue(), False)
        self.assertEqual(app.extract('scan.pdf', buffer.getvalue())[0][0], 1)

    def test_invalid_citation_fails_closed(self):
        sources = [{'citation': 1, 'text': 'Budget : 500 CHF.', 'name': 'budget.md', 'page': 1}]
        with patch.object(app, 'retrieve', return_value=sources), patch.object(app, 'structured', side_effect=[{'answer': '500 CHF [1]'}, {'answer': '500 CHF [99]', 'supported': True}]):
            result = app.answer('Quel budget ?', True)
        self.assertFalse(result['verified'])
        self.assertNotIn('[99]', result['answer'])

    def test_two_model_agents_and_valid_citation(self):
        with patch.object(app, 'retrieve', return_value=[{'citation': 1, 'text': '500 CHF'}]), patch.object(app, 'structured', side_effect=[{'answer': '500 CHF [1]'}, {'answer': 'Le budget est de 500 CHF [1].', 'supported': True}]) as model:
            result = app.answer('Quel budget ?', True)
        self.assertEqual(model.call_count, 2)
        self.assertTrue(result['verified'])
        self.assertEqual(len(result['trace']), 3)

    def test_hybrid_ranking_and_reindex(self):
        app.ingest('budget.md', b'Budget Atlas 500 CHF.', False)
        with patch.object(app, 'embeddings', side_effect=[[[1, 0]], [[1, 0]]]):
            hits = app.retrieve('cout du projet', True)
        self.assertEqual(len(hits), 1)
        self.assertGreater(hits[0]['score'], 0)

    def test_cloud_persistence_and_conflict(self):
        from google.api_core.exceptions import PreconditionFailed
        class Bucket:
            payload = None
            generation = 0
            size = 0
            conflict = False
            def get_blob(self, *args, **kwargs):
                return self if self.payload else None
            def blob(self, *args):
                return self
            def download_as_text(self, **kwargs):
                return self.payload
            def upload_from_string(self, value, **kwargs):
                if self.conflict or kwargs['if_generation_match'] != self.generation:
                    raise PreconditionFailed('conflict')
                self.payload = value
                self.size = len(value)
                self.generation += 1
        bucket = Bucket()
        with patch.dict(os.environ, {'GCS_BUCKET': 'test-bucket'}), patch('google.cloud.storage.Client') as client:
            client.return_value.bucket.return_value = bucket
            app.ingest('cloud.md', b'Atlas budget 500 CHF', False)
            self.assertIn('500 CHF', app.answer('budget Atlas', False)['answer'])
            bucket.conflict = True
            with self.assertRaises(app.StorageConflict):
                app.ingest('second.md', b'Autre fiche Atlas', False)
            self.assertEqual(len(json.loads(bucket.payload)['documents']), 1)


    def test_http_import_ask_and_origin(self):
        server = app.ThreadingHTTPServer(('127.0.0.1', 0), app.Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        url = f'http://127.0.0.1:{server.server_port}'
        def post(route, value, origin=None):
            headers = {'Content-Type': 'application/json'}
            if origin:
                headers['Origin'] = origin
            request = urllib.request.Request(url + route, json.dumps(value).encode(), headers)
            return json.load(urllib.request.urlopen(request))
        try:
            self.assertEqual(urllib.request.urlopen(url).status, 200)
            post('/api/documents', {'name': 'x.md', 'data': base64.b64encode(b'Budget Atlas 500 CHF').decode(), 'mode': 'extraits'})
            self.assertIn('500', post('/api/ask', {'question': 'budget Atlas', 'mode': 'extraits'})['answer'])
            with self.assertRaises(urllib.error.HTTPError) as failure:
                post('/api/delete', {'id': 'x'}, 'https://malicious.example')
            self.assertEqual(failure.exception.code, 403)
        finally:
            server.shutdown()
            server.server_close()


if __name__ == '__main__':
    unittest.main()
