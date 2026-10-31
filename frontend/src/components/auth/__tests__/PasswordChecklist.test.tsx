import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PasswordChecklist, checkPasswordCriteria } from "../PasswordChecklist";

describe("checkPasswordCriteria", () => {
  it("rejects passwords with length <= 8 characters", () => {
    const result8 = checkPasswordCriteria("Abc!1234");
    expect(result8.hasMinLength).toBe(false);
    expect(result8.isValid).toBe(false);

    const result7 = checkPasswordCriteria("Abc!123");
    expect(result7.hasMinLength).toBe(false);
    expect(result7.isValid).toBe(false);
  });

  it("accepts passwords with length >= 9 characters when other criteria match", () => {
    const result9 = checkPasswordCriteria("Abc!12345");
    expect(result9.hasMinLength).toBe(true);
    expect(result9.hasUppercase).toBe(true);
    expect(result9.hasLowercase).toBe(true);
    expect(result9.hasSpecial).toBe(true);
    expect(result9.isValid).toBe(true);
  });

  it("detects missing uppercase characters", () => {
    const result = checkPasswordCriteria("lowercase!1234");
    expect(result.hasUppercase).toBe(false);
    expect(result.hasLowercase).toBe(true);
    expect(result.hasSpecial).toBe(true);
    expect(result.isValid).toBe(false);
  });

  it("detects missing lowercase characters", () => {
    const result = checkPasswordCriteria("UPPERCASE!1234");
    expect(result.hasUppercase).toBe(true);
    expect(result.hasLowercase).toBe(false);
    expect(result.hasSpecial).toBe(true);
    expect(result.isValid).toBe(false);
  });

  it("detects missing special characters", () => {
    const result = checkPasswordCriteria("Password12345");
    expect(result.hasUppercase).toBe(true);
    expect(result.hasLowercase).toBe(true);
    expect(result.hasSpecial).toBe(false);
    expect(result.isValid).toBe(false);
  });

  it("returns all true and isValid true for strong valid passwords", () => {
    const result = checkPasswordCriteria("OrbitLedger@2026Secure");
    expect(result.hasMinLength).toBe(true);
    expect(result.hasUppercase).toBe(true);
    expect(result.hasLowercase).toBe(true);
    expect(result.hasSpecial).toBe(true);
    expect(result.isValid).toBe(true);
  });
});

describe("PasswordChecklist Component", () => {
  it("renders with accessible role status and aria-live polite", () => {
    render(<PasswordChecklist password="" />);
    const statusContainer = screen.getByRole("status");
    expect(statusContainer).toBeInTheDocument();
    expect(statusContainer).toHaveAttribute("aria-live", "polite");
    expect(screen.getByText(/Password Requirements/i)).toBeInTheDocument();
  });

  it("shows unmet indicators for empty password", () => {
    render(<PasswordChecklist password="" />);
    expect(screen.getByText(/More than 8 characters/i)).toBeInTheDocument();
    expect(screen.getByText(/At least one uppercase letter/i)).toBeInTheDocument();
    expect(screen.getByText(/At least one lowercase letter/i)).toBeInTheDocument();
    expect(screen.getByText(/At least one special character/i)).toBeInTheDocument();
  });

  it("highlights completed criteria when valid password is provided", () => {
    render(<PasswordChecklist password="SecurePassword!123" />);
    // Check that text has emerald highlight class
    const lengthItem = screen.getByText(/More than 8 characters/i);
    expect(lengthItem).toHaveClass("text-emerald-700");
    const upperItem = screen.getByText(/At least one uppercase letter/i);
    expect(upperItem).toHaveClass("text-emerald-700");
    const lowerItem = screen.getByText(/At least one lowercase letter/i);
    expect(lowerItem).toHaveClass("text-emerald-700");
    const specialItem = screen.getByText(/At least one special character/i);
    expect(specialItem).toHaveClass("text-emerald-700");
  });
});
