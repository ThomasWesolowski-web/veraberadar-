"""Prüft XRechnung (UBL) bzw. ZUGFeRD-XML (CII) mit den offiziellen Schematron-Regeln
(CEN EN 16931 + KoSIT XRechnung) über Saxon-HE (saxonche).
Aufruf: python3 validate_official.py ubl|cii datei.xml [--xrechnung] [--rules VERZEICHNIS]
"""
import os
import re
import sys
from saxonche import PySaxonProcessor

HERE = os.path.dirname(os.path.abspath(__file__))
if "--rules" in sys.argv:
    HERE = os.path.abspath(sys.argv[sys.argv.index("--rules") + 1])
SVRL = "{http://purl.oclc.org/dsdl/svrl}"


def compile_sch(proc, sch, out):
    if os.path.exists(out) and os.path.getmtime(out) > os.path.getmtime(sch):
        return out
    xp = proc.new_xslt30_processor()
    ex = xp.compile_stylesheet(stylesheet_file=os.path.join(HERE, "schx/xslt/2.0/pipeline-for-svrl.xsl"))
    ex.transform_to_file(source_file=sch, output_file=out)
    return out


def run(proc, xslt, xml):
    xp = proc.new_xslt30_processor()
    ex = xp.compile_stylesheet(stylesheet_file=xslt)
    res = ex.transform_to_string(source_file=xml)
    findings = []
    for m in re.finditer(r'<svrl:(failed-assert|successful-report)([^>]*)>(.*?)</svrl:\1>', res, re.S):
        attrs = m.group(2)
        rid = re.search(r'id="([^"]+)"', attrs)
        flag = re.search(r'flag="([^"]+)"', attrs)
        loc = re.search(r'location="([^"]+)"', attrs)
        text = re.sub(r"<[^>]+>", "", m.group(3))
        text = re.sub(r"\s+", " ", text).strip()
        findings.append((flag.group(1) if flag else "?", rid.group(1) if rid else "?", text[:220], loc.group(1)[:120] if loc else ""))
    return findings


def main():
    syntax, xml = sys.argv[1], os.path.abspath(sys.argv[2])
    xr = "--xrechnung" in sys.argv
    with PySaxonProcessor(license=False) as proc:
        sets = [("EN 16931", os.path.join(HERE, f"en16931-{syntax}.xslt"))]
        if xr:
            sch = os.path.join(HERE, syntax, f"XRechnung-{syntax.upper()}-validation.sch")
            sets.append(("XRechnung", compile_sch(proc, sch, os.path.join(HERE, f"xr-{syntax}.xslt"))))
        total_fatal = 0
        for name, xslt in sets:
            f = run(proc, xslt, xml)
            fatal = [x for x in f if x[0] in ("fatal", "error")]
            total_fatal += len(fatal)
            print(f"== {name}: {len(fatal)} Fehler, {len(f) - len(fatal)} Warnungen/Infos")
            for x in f:
                print(f"   [{x[0]}] {x[1]}: {x[2]}  @ {x[3]}")
        sys.exit(1 if total_fatal else 0)


main()
