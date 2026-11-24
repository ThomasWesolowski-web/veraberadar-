#!/usr/bin/env bash
# Offizielle Prüfung der erzeugten Rechnungen mit den Schematron-Regeln von CEN (EN 16931)
# und KoSIT (XRechnung) sowie dem CII-XML-Schema. Benötigt: node, python3, pip, curl, unzip.
set -euo pipefail
cd "$(dirname "$0")"
C=.cache
mkdir -p "$C/ubl" "$C/cii" "$C/xsd" "$C/schx"
RAW=https://raw.githubusercontent.com
EN=$RAW/ConnectingEurope/eInvoicing-EN16931/master
XR=$RAW/itplr-kosit/xrechnung-schematron/master/src/validation/schematron
dl() { [ -s "$2" ] || curl -fsSL -o "$2" "$1"; }
dl "$EN/ubl/xslt/EN16931-UBL-validation.xslt" "$C/en16931-ubl.xslt"
dl "$EN/cii/xslt/EN16931-CII-validation.xslt" "$C/en16931-cii.xslt"
dl "$XR/common.sch" "$C/common.sch"
dl "$XR/ubl/XRechnung-UBL-validation.sch" "$C/ubl/XRechnung-UBL-validation.sch"
dl "$XR/cii/XRechnung-CII-validation.sch" "$C/cii/XRechnung-CII-validation.sch"
XSD="$EN/cii/schema/D16B%20SCRDM%20(Subset)/uncoupled%20clm/CII/uncefact/data/standard"
for f in CrossIndustryInvoice_100pD16B CrossIndustryInvoice_ReusableAggregateBusinessInformationEntity_100pD16B \
         CrossIndustryInvoice_QualifiedDataType_100pD16B CrossIndustryInvoice_UnqualifiedDataType_100pD16B; do
  dl "$XSD/$f.xsd" "$C/xsd/$f.xsd"
done
dl https://repo1.maven.org/maven2/name/dmaus/schxslt/schxslt/1.10.1/schxslt-1.10.1.jar "$C/schxslt.jar"
[ -d "$C/schx/xslt" ] || (cd "$C/schx" && unzip -oq ../schxslt.jar)
python3 -c "import saxonche, lxml" 2>/dev/null || pip install -q saxonche lxml

node gen-samples.mjs .samples
fail=0
for f in .samples/*.ubl.xml; do
  echo "### $f"; python3 validate_official.py ubl "$f" --xrechnung --rules "$C" || fail=1
done
for f in .samples/*.cii-en16931.xml; do
  echo "### $f"; python3 validate_official.py cii "$f" --rules "$C" || fail=1
done
for f in .samples/*.cii-xrechnung.xml; do
  echo "### $f"; python3 validate_official.py cii "$f" --xrechnung --rules "$C" || fail=1
done
python3 - "$C" <<'PY' || fail=1
import glob, sys
from lxml import etree
xsd = etree.XMLSchema(etree.parse(f"{sys.argv[1]}/xsd/CrossIndustryInvoice_100pD16B.xsd"))
bad = [f for f in sorted(glob.glob(".samples/*.cii-*.xml")) if not xsd.validate(etree.parse(f))]
print("CII-Schema:", "alle gültig" if not bad else f"ungültig: {bad}")
sys.exit(1 if bad else 0)
PY
exit $fail
