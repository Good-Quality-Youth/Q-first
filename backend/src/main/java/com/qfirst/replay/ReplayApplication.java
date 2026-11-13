package com.qfirst.replay;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@org.springframework.scheduling.annotation.EnableScheduling
@SpringBootApplication
public class ReplayApplication {
    public static void main(String[] args) {
        SpringApplication.run(ReplayApplication.class, args);
    }
}
