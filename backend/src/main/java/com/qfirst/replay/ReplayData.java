package com.qfirst.replay;

import java.io.IOException;
import java.io.PushbackReader;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.*;
import java.util.function.Consumer;
import org.apache.commons.csv.CSVFormat;
import org.apache.commons.csv.CSVRecord;

final class ReplayData {
    static final ZoneId KST = ZoneId.of("Asia/Seoul");
    static final Instant START = clock("13:41");
    static final Instant END = clock("14:15");
    final Map<String, Equipment> equipment = new TreeMap<>();
    final Map<String, NavigableMap<Instant, Reading>> readings = new HashMap<>();
    final Map<String, List<Inspection>> inspections = new HashMap<>();
    final Map<String, Lot> lots = new HashMap<>();
    final Map<String, Assessment> assessments = new HashMap<>();
    final List<ScenarioEvent> events = new ArrayList<>();

    record Equipment(String id, String no, String part, String metric, String label, String unit,
                     double reference, double lower, double upper) {}
    record Reading(String id, Instant at, String equipmentId, String lot, String error, double value) {}
    record Inspection(String id, Instant at, Instant producedAt, boolean defect, String type) {}
    record Lot(String equipmentId, Instant start, Instant end) {}
    record Assessment(double score, int risk) {}
    record ScenarioEvent(String id, String equipmentId, Instant detectedAt, Instant startedAt,
                         String inspector, String guide, String checkCode, String topSensor, Instant firstWarningAt, Instant alarmAt) {}

    ReplayData(Path root) throws IOException {
        read(root, "equipment_registry.csv", row -> {
            String id = row.get("equipment_id");
            String part = row.get("part_type");
            boolean temp = part.equals("CAP");
            boolean rpm = id.equals("EQP-004");
            String prefix = temp ? "temp" : rpm ? "rpm" : "pressure";
            String suffix = temp ? "_c" : rpm ? "" : "_kpa";
            double scale = temp || rpm ? 1 : .001;
            equipment.put(id, new Equipment(id, Integer.parseInt(id.substring(4)) + "호기", row.get("part_name"),
                    temp ? "barrelTemperature" : rpm ? "screwSpeed" : "injectionPressure",
                    temp ? "배럴 온도" : rpm ? "스크류 회전 속도" : "사출 압력",
                    temp ? "°C" : rpm ? "rpm" : "MPa", number(row, "baseline_" + prefix + suffix) * scale,
                    number(row, prefix + "_low_limit" + suffix) * scale,
                    number(row, prefix + "_high_limit" + suffix) * scale));
        });
        read(root, "equipment_status.csv", row -> {
            Instant at = time(row.get("recorded_at"));
            if (at.isBefore(clock("12:00")) || at.isAfter(END)) return;
            String id = row.get("equipment_id");
            double value = switch (equipment.get(id).metric()) {
                case "barrelTemperature" -> number(row, "temperature_celsius");
                case "screwSpeed" -> number(row, "rotation_speed_rpm");
                default -> number(row, "pressure_kpa") / 1000;
            };
            readings.computeIfAbsent(id, ignored -> new TreeMap<>()).put(at,
                    new Reading(row.get("equip_status_id"), at, id, row.get("lot_no"), row.get("error_code"), value));
        });
        read(root, "lot_history.csv", row -> {
            lots.put(row.get("lot_no"), new Lot(row.get("equipment_id"), time(row.get("production_start")),
                    time(row.get("production_end"))));
        });
        read(root, "lot_inspection_feed.csv", row -> {
            Instant at = time(row.get("inspected_at"));
            if (at.isBefore(clock("12:00")) || at.isAfter(END)) return;
            String lot = row.get("lot_no");
            Instant producedAt = lots.get(lot).start().plusSeconds(60L * (Integer.parseInt(row.get("lot_seq")) - 1));
            inspections.computeIfAbsent(lot, ignored -> new ArrayList<>()).add(
                    new Inspection(row.get("inspection_record_id"), at, producedAt,
                            Integer.parseInt(row.get("defect_count")) > 0, row.get("defect_type")));
        });
        if (equipment.size() != 10) throw new IllegalArgumentException("v8 설비 10대를 확인하세요.");
    }

    Reading current(String equipmentId, Instant at) {
        return readings.get(equipmentId).floorEntry(at).getValue();
    }

    static Instant clock(String clock) {
        return time("2026-02-03T" + clock + ":00Z");
    }

    private static Instant time(String value) {
        if (value.isBlank()) return null;
        return LocalDateTime.parse(value.replaceFirst("Z$", "")).atZone(KST).toInstant();
    }

    private static double number(CSVRecord record, String name) {
        return Double.parseDouble(record.get(name));
    }

    private static void read(Path root, String name, Consumer<CSVRecord> consume) throws IOException {
        try (var reader = new PushbackReader(Files.newBufferedReader(root.resolve(name)))) {
            int first = reader.read();
            if (first != -1 && first != '\ufeff') reader.unread(first);
            try (var parser = CSVFormat.DEFAULT.builder().setHeader().setSkipHeaderRecord(true).get().parse(reader)) {
                parser.forEach(consume);
            }
        }
    }
}
