"""Teste un vrai PDF de 30 Mio sur le service public, puis retire sa propre fiche."""
import argparse
import hashlib
import io
import json
import ssl
import urllib.request
from urllib.parse import quote
import uuid

import certifi
from pypdf import PdfWriter
from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject


def generate_pdf(size, marker):
    def build(padding):
        writer = PdfWriter()
        page = writer.add_blank_page(width=595, height=842)
        font = DictionaryObject({NameObject('/Type'): NameObject('/Font'), NameObject('/Subtype'): NameObject('/Type1'), NameObject('/BaseFont'): NameObject('/Helvetica')})
        page[NameObject('/Resources')] = DictionaryObject({NameObject('/Font'): DictionaryObject({NameObject('/F1'): writer._add_object(font)})})
        stream = DecodedStreamObject()
        stream.set_data(f'BT /F1 12 Tf 40 800 Td (Validation import 30 Mo {marker}) Tj ET'.encode())
        page[NameObject('/Contents')] = writer._add_object(stream)
        writer.add_attachment('padding-test.bin', b'0' * padding)
        buffer = io.BytesIO()
        writer.write(buffer)
        return buffer.getvalue()

    padding = max(0, size - 4096)
    for _ in range(4):
        payload = build(padding)
        if len(payload) == size:
            return payload
        padding += size - len(payload)
    raise AssertionError('Impossible de générer la taille exacte du PDF de contrôle.')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--url', required=True)
    args = parser.parse_args()
    base = args.url.rstrip('/')
    context = ssl.create_default_context(cafile=certifi.where())
    def request(path, body=None, headers=None):
        req = urllib.request.Request(base + '/api/' + path, body, headers or {})
        with urllib.request.urlopen(req, context=context, timeout=300) as response:
            return json.load(response)

    marker = uuid.uuid4().hex
    payload = generate_pdf(30 * 1024 * 1024, marker)
    identity = hashlib.sha256(payload).hexdigest()[:24]
    before = {doc['id'] for doc in request('status')['documents']}
    assert identity not in before
    print(f'PDF de contrôle : {len(payload)} octets, une page de texte.', flush=True)
    try:
        result = request('documents', payload, {'Content-Type': 'application/octet-stream', 'X-File-Name': quote('controle-30mo-' + marker + '.pdf'), 'X-Upload-Mode': 'extraits'})
        assert result.get('chunks', 0) > 0 and not result['duplicate']
        body = json.dumps({'question': 'Validation import', 'mode': 'extraits', 'document_ids': [identity]}).encode()
        answer = request('ask', body, {'Content-Type': 'application/json'})
        assert marker in answer['answer']
        print('Import public de 30 Mio et extraction du texte : OK', flush=True)
    finally:
        if identity in {doc['id'] for doc in request('status')['documents']}:
            request('delete', json.dumps({'id': identity}).encode(), {'Content-Type': 'application/json'})
            print('Fiche de contrôle retirée ; autres documents conservés.', flush=True)


if __name__ == '__main__':
    main()
