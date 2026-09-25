# External AI processing disabled

The privacy release always uses local OCR and built-in extraction rules.
TYPELLM_URL, TYPELLM_MODEL and related legacy environment variables cannot enable
runtime document transmission. The legacy adapter remains only for compatibility
with unit-test fixtures; it is not selected by the application.

Use the Documents & bills view to review OCR results manually. See PRIVACY.md.
