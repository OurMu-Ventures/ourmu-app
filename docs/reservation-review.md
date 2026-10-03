# Pending reservation review

Reservations retain cycle capacity and count toward partner limits until activated, manually expired, or cancelled by the investor. They have no automatic expiry.

Administrators should review `/admin/activations` daily, oldest first. The admin overview shows the oldest pending reservation age and highlights review once it reaches 72 hours. Contact partners with reservations pending for three days to confirm payment status and intentions. Check bank statements and outstanding payment evidence before manually expiring an abandoned reservation. Escalate unresolved payments for staff reconciliation; do not ask partners to pay again.

After confirming a reservation should be released, use Expire reservation with MFA and typed EXPIRE confirmation. This releases its reserved capacity, prevents activation, and records the cycle and principal in the audit log. This three-day threshold prompts manual review; it is not a payment deadline or automatic expiry rule.

`reservation_expires_at` is NULL while pending. On resolved records it can hold a historical automatic-expiry deadline or a manual expiry timestamp; it is not a current payment deadline.
