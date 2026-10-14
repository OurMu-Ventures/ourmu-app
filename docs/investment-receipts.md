# Investment receipt behavior

Every active investment offers **Download receipt**, including imported placements and reinvestments. Missing receipts are issued on demand. Downloads reuse the immutable receipt number and stored PDF without queuing activation emails.

## Review considerations

- Simultaneous first-generation requests can both render a PDF. This is accepted duplicate work: the receipt RPC serializes issuance, storage rejects overwrites, and the losing upload reads the stored bytes before recording their hash. The concurrency regression test starts both renders together and verifies one stored PDF and matching hashes. A distributed generation lease can reduce rendering work later if volume warrants it.
- `ensure_investment_receipt` is the authoritative gate for minting. It checks ownership and permits a missing receipt only for an active investment. It returns an existing receipt before the status check, preserving retrieval after maturity. UI and action changes must preserve that distinction. Database tests cover both existing matured receipts and denial of new receipts for non-active investments.
- The partner overview heading reads **Your active and past investments**, matching the records listed beneath it.

## Deployment

Apply `20261014130225_receipt_investment_record_source.sql` followed by `20261014130249_on_demand_investment_receipts.sql` before releasing the application. Imported records without bank or portal rollover evidence receive an investment acknowledgment; the system does not invent transaction references.
