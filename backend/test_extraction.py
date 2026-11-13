import unittest

from extraction import UNKNOWN, extract_without_ai, finalize, merge_results


class ExtractionTests(unittest.TestCase):
    def parse(self, text):
        return finalize(extract_without_ai(text))

    def test_word_weeks_and_general_information_like_models_syllabus(self):
        text = """1. Información General
1.1 Nombre de la Asignatura: Modelos y Simulación
1.9 Duración: 16 semanas
1.10 Fecha de inicio: 24 de agosto de 2026
1.11 Fecha de finalización: 12 de diciembre de 2026
1.13 Horario: G1: Jueves 14:00-18:00
3. Unidades de aprendizaje
UNIDAD I
Duración: 4 semanas
Semana Contenido temático Estrategia metodológica
Primera Presentación del sílabo
Segunda Conceptos de simulación
Cuarta Práctica calificada 1
UNIDAD II
Octava Examen parcial
Duodécima Práctica calificada 2
Decimosexta Examen final
5. Sistema de evaluación
Examen parcial 30%
Examen final 40%
Práctica calificada 30%
"""
        parsed = extract_without_ai(text)
        self.assertEqual(parsed["fecha_inicio"], "2026-08-24")
        self.assertEqual(parsed["fecha_fin"], "2026-12-12")
        self.assertEqual(parsed["duracion_semanas"], 16)
        evs = finalize(parsed)
        self.assertEqual([e["semana"] for e in evs], [4, 8, 12, 16])
        self.assertEqual([e["fecha"] for e in evs], ["2026-09-17", "2026-10-15", "2026-11-12", "2026-12-10"])
        self.assertTrue(all(e["fecha_origen"] == "calculada" for e in evs))

    def test_first_class_anchors_week_one_when_no_schedule_day_is_given(self):
        evs = self.parse("Fecha de inicio: 24 de agosto de 2026\nSemana primera PC1\nSemana octava Examen parcial")
        self.assertEqual([e["fecha"] for e in evs], ["2026-08-24", "2026-10-12"])

    def test_standalone_word_week_and_repeated_table_header(self):
        evs = self.parse("Fecha de inicio: 24/08/2026\nHorario: Jueves\nSemana Contenido temático\nOctava\n\f\nSemana Contenido temático\nExamen parcial")
        self.assertEqual((evs[0]["semana"], evs[0]["fecha"]), (8, "2026-10-15"))

    def test_compound_word_weeks_and_accents(self):
        for label, expected in (("Décima primera", 11), ("Undécima", 11), ("Décimo segunda", 12),
                                ("Duodécima", 12), ("Décima sexta", 16), ("Decimosexta", 16),
                                ("Vigésima", 20), ("Vigésima primera", 21)):
            with self.subTest(label=label):
                evs = self.parse("CRONOGRAMA\n" + label + " Examen final")
                self.assertEqual(evs[0]["semana"], expected)

    def test_week_before_word_label_and_word_week_ranges(self):
        evs = self.parse("Octava semana Examen parcial\nSemana décima sexta Examen final")
        self.assertEqual([e["semana"] for e in evs], [8, 16])
        evs = self.parse("CRONOGRAMA\nCuarta PC1\nOctava a novena Examen parcial")
        self.assertEqual(next(e for e in evs if e["nombre"] == "Examen Parcial")["semana"], 0)

    def test_calculated_dates_must_fit_course_end_and_duration(self):
        text = "Fecha de inicio: 24/08/2026\nHorario: Jueves\nFecha de finalización: 12/12/2026\nCRONOGRAMA\nDecimosexta Examen final\nDecimoséptima Examen sustitutorio"
        evs = self.parse(text)
        self.assertEqual(evs[0]["fecha"], "2026-12-10")
        self.assertEqual(evs[1]["fecha"], UNKNOWN)
        evs = self.parse("Fecha de inicio: 24/08/2026\nDuración: 8 semanas\nSemana novena Examen final")
        self.assertEqual(evs[0]["fecha"], UNKNOWN)

    def test_unit_duration_is_not_the_duration_of_the_course(self):
        parsed = extract_without_ai("Fecha de inicio: 24/08/2026\nUNIDAD I\nDuración: 4 semanas\nSemana octava Examen parcial")
        self.assertEqual(parsed["duracion_semanas"], 0)
        self.assertEqual(finalize(parsed)[0]["fecha"], "2026-10-12")

    def test_explicit_rescheduled_exam_after_course_end_is_preserved(self):
        evs = self.parse("Fecha de inicio: 24/08/2026\nFecha de finalización: 12/12/2026\nSemana 17 Examen sustitutorio 17/12/2026")
        self.assertEqual((evs[0]["fecha"], evs[0]["fecha_origen"]), ("2026-12-17", "explicita"))

    def test_ai_merge_keeps_rules_week_and_end_date(self):
        rules = extract_without_ai("Fecha de inicio: 24/08/2026\nHorario: Jueves\nFecha de finalización: 12/12/2026\nCRONOGRAMA\nOctava Examen parcial")
        ai = {"evaluaciones": [{"nombre": "Examen parcial", "semana": 0, "peso": 30}]}
        merged = merge_results(ai, rules)
        self.assertEqual(merged["fecha_fin"], "2026-12-12")
        self.assertEqual(finalize(merged)[0]["fecha"], "2026-10-15")

    def test_course_start_and_accented_day_calculate_date(self):
        parsed = extract_without_ai("Curso: Cálculo I\nFecha de inicio: 24/08/2026\nHorario: Miércoles\nSemana 8 Examen Parcial")
        self.assertEqual(parsed["nombre_curso"], "Cálculo I")
        ev = finalize(parsed)[0]
        self.assertEqual((ev["fecha"], ev["fecha_origen"]), ("2026-10-14", "calculada"))

    def test_all_practices_and_abbreviations(self):
        evs = self.parse("CRONOGRAMA\n4 PC1 10%\n6 Práctica calificada II 12,5%\n10 PC3 10%\n12 PC4 10%")
        self.assertEqual([e["semana"] for e in evs], [4, 6, 10, 12])
        self.assertEqual(evs[1]["nombre"], "Práctica Calificada 2")
        self.assertEqual(evs[1]["peso"], 12.5)

    def test_ordinal_practices_and_number_labels(self):
        evs = self.parse("Semana: 3 Primera práctica calificada\nSemana 6 2da práctica calificada\nSemana 12 PC N° 3")
        self.assertEqual([e["nombre"] for e in evs], ["Práctica Calificada 1", "Práctica Calificada 2", "Práctica Calificada 3"])

    def test_practice_percentage_is_not_its_number(self):
        ev = self.parse("Práctica calificada 40%")[0]
        self.assertEqual(ev["nombre"], "Práctica Calificada")
        self.assertEqual(ev["peso"], 40)

    def test_roman_weeks_and_table_columns(self):
        evs = self.parse("Semana Fecha Actividad\n| VIII | 14/10/2026 | EP | 30%\nXVI 9/12/2026 EF 40%")
        self.assertEqual([(e["semana"], e["fecha"]) for e in evs], [(8, "2026-10-14"), (16, "2026-12-09")])

    def test_sections_percentages_and_course_codes_are_not_weeks(self):
        evs = self.parse("1.1 Curso: Matemática\n20% Examen parcial\n2026 Examen final\n3.2 Práctica calificada")
        self.assertTrue(all(e["semana"] == 0 for e in evs))
        self.assertTrue(all(e["fecha"] == UNKNOWN for e in evs))

    def test_multiple_evaluations_in_one_line(self):
        evs = self.parse("Semana 8 PC1 10% y Examen Parcial 25%")
        self.assertEqual(len(evs), 2)
        self.assertEqual(sorted(e["peso"] for e in evs), [10, 25])

    def test_explicit_date_overrides_week_calculation(self):
        evs = self.parse("Inicio de clases: 24 de agosto de 2026\nHorario: Lunes\nSemana 8 Examen parcial 16 de octubre de 2026")
        self.assertEqual((evs[0]["fecha"], evs[0]["fecha_origen"]), ("2026-10-16", "explicita"))

    def test_missing_year_and_invalid_dates_stay_unknown(self):
        for text in ("Semana 8 EP 16/10", "Semana 8 EP 31/02/2026"):
            self.assertEqual(self.parse(text)[0]["fecha"], UNKNOWN)

    def test_date_ranges_are_not_exact_dates(self):
        for dates in ("12/10/2026 al 18/10/2026", "del 12 al 18/10/2026", "12–18/10/2026"):
            self.assertEqual(self.parse("Semana 8 Examen Parcial " + dates)[0]["fecha"], UNKNOWN)

    def test_week_ranges_do_not_reuse_previous_week(self):
        for row in ("Semanas 8 a 9 EP", "8-9 EP"):
            evs = self.parse("CRONOGRAMA\n4 PC1\n" + row)
            self.assertEqual(next(e for e in evs if e["nombre"] == "Examen Parcial")["semana"], 0)

    def test_summary_deduplicates_and_preserves_exam_weight(self):
        evs = self.parse("Evaluación\nExamen parcial 30%\nPráctica calificada 40%\nCRONOGRAMA\nSemana 4 PC1\nSemana 8 EP\nSemana 12 PC2")
        self.assertEqual(len(evs), 3)
        self.assertEqual(next(e for e in evs if e["nombre"] == "Examen Parcial")["peso"], 30)
        self.assertTrue(all(e["peso"] == 0 for e in evs if "Práctica" in e["nombre"]))

    def test_section_after_schedule_resets_week(self):
        evs = self.parse("CRONOGRAMA\n16 Examen final\nBIBLIOGRAFÍA\nPráctica calificada 3")
        self.assertEqual(next(e for e in evs if "Práctica" in e["nombre"])["semana"], 0)

    def test_no_forced_project_final_or_week_fifteen(self):
        evs = self.parse("Semana 15 1er Entregable de Proyecto\nSemana 16 Entrega de proyecto final")
        self.assertEqual(len(evs), 2)
        self.assertIn("1er", evs[0]["nombre"])
        self.assertIn("final", evs[1]["nombre"])

    def test_routine_activities_and_exam_preparation_are_ignored(self):
        self.assertEqual(self.parse("Semana 7 Práctica dirigida\nRepaso para examen parcial\nIntroducción al proyecto final\nLaboratorio semanal"), [])

    def test_split_week_and_course_labels(self):
        parsed = extract_without_ai("Asignatura:\nFísica II\nSemana 8\nExamen parcial")
        self.assertEqual(parsed["nombre_curso"], "Física II")
        self.assertEqual(parsed["evaluaciones"][0]["semana"], 8)

    def test_ai_merge_retains_explicit_dates_and_missing_practices(self):
        rules = extract_without_ai("Semana 8 EP 14/10/2026\nSemana 12 PC3")
        ai = {"nombre_curso": "Física", "fecha_inicio": UNKNOWN, "dia_clases": "",
              "evaluaciones": [{"nombre": "Examen parcial", "semana": 8, "fecha": UNKNOWN, "peso": 20}]}
        evs = finalize(merge_results(ai, rules))
        self.assertEqual(len(evs), 2)
        self.assertEqual(evs[0]["fecha"], "2026-10-14")


if __name__ == "__main__":
    unittest.main()
