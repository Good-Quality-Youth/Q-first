package com.qfirst.replay;

import java.util.Map;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1")
@ConditionalOnProperty(name = "qfirst.demo.enabled", havingValue = "true")
final class ReplayController {
    private final ReplayService replay;

    ReplayController(ReplayService replay) { this.replay = replay; }

    @GetMapping("/board")
    ReplayService.Board board() { return replay.board(); }

    @GetMapping("/incidents/{id}")
    ReplayService.Detail detail(@PathVariable String id, @RequestParam(required = false) Integer revision) {
        return replay.incident(id, revision);
    }

    @GetMapping("/equipment/{id}/series")
    ReplayService.Series series(@PathVariable String id, @RequestParam java.time.Instant asOf) {
        return replay.series(id,asOf);
    }

    @GetMapping("/notifications")
    ReplayService.NotificationPage notifications(@RequestParam String after) { return replay.notifications(after); }

    @PostMapping("/demo/replay/next")
    ReplayService.Advanced advance(@RequestBody ReplayService.Advance body,
                                   @RequestHeader(value = "Idempotency-Key", required = false) String key) {
        return replay.advance(body, key);
    }

    @ExceptionHandler(ReplayError.class)
    ResponseEntity<Map<String, Object>> failure(ReplayError error) {
        return ResponseEntity.status(error.status).body(Map.of("error",
                Map.of("code", error.getMessage(), "message", error.getMessage())));
    }
}
