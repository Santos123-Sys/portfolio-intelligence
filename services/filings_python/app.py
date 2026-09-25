"""Private Railway service: PDF -> structured draft -> deterministic Python analysis."""
import base64
import hmac
import os
import re
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field
from openai import OpenAI
from .analysis import Extraction, analyze

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)

class ExtractionRequest(BaseModel):
    content_base64: str = Field(max_length=7_000_000)
    file_name: str = Field(min_length=1, max_length=160)
    expected_issuer: str = Field(min_length=3, max_length=200)
    expected_currency: str = Field(pattern=r'^[A-Z]{3}$')

@app.get('/health')
def health():
    return {'status': 'ok'}

def issuer_matches(expected: str, extracted: str) -> bool:
    words = lambda value: [word for word in re.sub(r'[^A-Z0-9 ]', ' ', value.upper()).split()
                           if len(word) >= 4 and word not in {'GROUP', 'HOLDING', 'HOLDINGS', 'LIMITED', 'COMPANY'}]
    return bool(set(words(expected)) & set(words(extracted)))

@app.post('/v1/financial-extractions')
def financial_extraction(body: ExtractionRequest, authorization: str = Header(default='')):
    secret = os.getenv('FILINGS_INTERNAL_TOKEN', '')
    if len(secret) < 32 or not hmac.compare_digest(authorization, f'Bearer {secret}'):
        raise HTTPException(401, 'Unauthorized')
    try:
        pdf = base64.b64decode(body.content_base64, validate=True)
    except Exception:
        raise HTTPException(400, 'Invalid document encoding')
    if not pdf.startswith(b'%PDF-') or b'%%EOF' not in pdf[-4096:] or len(pdf) > 5_000_000:
        raise HTTPException(400, 'Complete PDF of at most 5 MB required')
    if re.search(rb'/(?:JavaScript|JS|Launch|EmbeddedFile|Filespec|RichMedia|XFA|AA|Encrypt)\b', pdf, re.I):
        raise HTTPException(400, 'Active or encrypted PDF is not accepted')
    client = OpenAI(api_key=os.environ['OPENAI_API_KEY'], timeout=90, max_retries=1)
    result = client.responses.parse(
        model=os.getenv('FILINGS_EXTRACTION_MODEL', 'gpt-4.1'),
        instructions=('Extract only explicitly printed consolidated annual financial figures from the PDF. '
                      'Copy the issuer, exact fiscal start/end, currency, displayed amount, unit multiplier, PDF page number, '
                      'and a short evidence quote for each fact. Allowed metrics: revenue, gross_profit, operating_income, '
                      'net_income, operating_cash_flow, capital_expenditure, cash_and_equivalents, total_debt, total_equity, '
                      'shares_outstanding. Do not compute, infer, convert currencies, choose between conflicting contexts, '
                      'or invent a missing fact. For uncertainty, add a gap and omit the fact. Output a draft for human review.'),
        input=[{'role': 'user', 'content': [
            {'type': 'input_text', 'text': f'Issuer: {body.expected_issuer}. Expected native currency: {body.expected_currency}.'},
            {'type': 'input_file', 'filename': body.file_name,
             'file_data': f'data:application/pdf;base64,{body.content_base64}'},
        ]}],
        text_format=Extraction,
    )
    extracted = result.output_parsed
    if extracted is None:
        raise HTTPException(422, 'No structured PDF extraction returned')
    if not issuer_matches(body.expected_issuer, extracted.issuer_name):
        raise HTTPException(422, 'Extracted issuer does not match candidate')
    analysis = analyze(extracted, body.expected_currency)
    return {'extraction': extracted.model_dump(), 'analysis': analysis}
