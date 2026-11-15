/** QA diagnostics must not persist Android accessibility password text. */
export function redactQaPasswordXml(xml){return xml.replace(/<node\b[^>]*\bpassword="true"[^>]*>/g,node=>node.replace(/\btext="[^"]*"/,'text="[redacted]"'));}
export function qaScreenshotAllowed(xml){return !/<node\b[^>]*\bpassword="true"[^>]*>/.test(xml);}