package main

import rego.v1

# Helper: extract text from heading node children
heading_text(h) := concat("", [c.value | some c in h.children; c.type == "text"])

# All headings in the document
headings := [h | some h in input.children; h.type == "heading"]

# Rule 1: H1 must match title pattern
deny contains msg if {
	some h in headings
	h.depth == 1
	text := heading_text(h)
	not regex.match(`^Oksskolten Spec — .+$`, text)
	msg := sprintf("H1 must match 'Oksskolten Spec — {Feature}', got: '%s'", [text])
}

deny contains msg if {
	h1s := [h | some h in headings; h.depth == 1]
	count(h1s) != 1
	msg := sprintf("Spec must have exactly one H1, found %d", [count(h1s)])
}

# Rule 2: Feature specs (filename contains _feature_) must have exactly one H2
# When input.metadata.is_feature is true, enforce single H2.
deny contains msg if {
	object.get(input, ["metadata", "is_feature"], false) == true
	h2s := [h | some h in headings; h.depth == 2]
	count(h2s) != 1
	msg := sprintf("Feature spec must have exactly one H2 (feature name), found %d", [count(h2s)])
}

# Rule 3: Forbidden section names
forbidden_prefixes := ["Current Status", "Implementation Checklist", "Discrepancies", "Updates", "Reference:"]

deny contains msg if {
	some h in headings
	text := heading_text(h)
	some prefix in forbidden_prefixes
	startswith(text, prefix)
	msg := sprintf("Forbidden section name: '%s'", [text])
}

# Rule 4: Key Files table must have 2 columns (File | Description)
deny contains msg if {
	some i, node in input.children
	node.type == "heading"
	node.depth == 3
	heading_text(node) == "Key Files"

	# Find the next table after this heading
	some j, tbl in input.children
	j > i
	tbl.type == "table"

	# Check column count via first row (header)
	header := tbl.children[0]
	col_count := count(header.children)
	col_count != 2
	msg := sprintf("Key Files table must have 2 columns (File | Description), found %d", [col_count])
}

# Rule 5: No heading deeper than H4
deny contains msg if {
	some h in headings
	h.depth > 4
	text := heading_text(h)
	msg := sprintf("Heading depth %d exceeds maximum (H4): '%s'", [h.depth, text])
}

# Rule 6: Non-overview specs must have "Back to Overview" blockquote immediately after H1
# Expected AST: children[0] = heading(depth=1), children[1] = blockquote containing
# a link to ./01_overview.md with text "Back to Overview" (title case).
# Skipped for 01_overview.md (it IS the overview).

deny contains msg if {
	filename := object.get(input, ["metadata", "filename"], "")
	filename != ""
	filename != "01_overview.md"
	count(input.children) >= 2
	input.children[0].type == "heading"
	input.children[0].depth == 1
	node := input.children[1]
	not _is_back_to_overview(node)
	msg := "Non-overview spec must have '> [Back to Overview](./01_overview.md)' immediately after H1"
}

deny contains msg if {
	filename := object.get(input, ["metadata", "filename"], "")
	filename != ""
	filename != "01_overview.md"
	count(input.children) < 2
	msg := "Non-overview spec must have '> [Back to Overview](./01_overview.md)' immediately after H1"
}

_is_back_to_overview(node) if {
	node.type == "blockquote"
	some para in node.children
	para.type == "paragraph"
	some link in para.children
	link.type == "link"
	link.url == "./01_overview.md"
	some text in link.children
	text.type == "text"
	text.value == "Back to Overview"
}

# Rule 7: 01_overview.md must link to every other spec file
# Uses walk() to collect all link URLs in the AST and checks that every file
# in all_filenames (except 01_overview.md) appears as "./filename".

_all_link_urls := {url | walk(input, [_, node]); node.type == "link"; url := node.url}

deny contains msg if {
	filename := object.get(input, ["metadata", "filename"], "")
	filename == "01_overview.md"
	all_filenames := object.get(input, ["metadata", "all_filenames"], [])
	some f in all_filenames
	f != "01_overview.md"
	expected_url := sprintf("./%s", [f])
	not expected_url in _all_link_urls
	msg := sprintf("01_overview.md must link to all spec files, missing: '%s'", [f])
}
