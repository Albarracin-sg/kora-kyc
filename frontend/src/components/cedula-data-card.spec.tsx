import { render, screen } from "@testing-library/react-native";
import { CedulaDataCard } from "./cedula-data-card";
import { DOCUMENT_CHECK_RESULT } from "../types/api";

describe("CedulaDataCard", () => {
  it("renders the typed cedula fields with a valid verdict", () => {
    render(
      <CedulaDataCard
        fullName="PEPITA PEREZ"
        documentNumber="12345678"
        birthDate="1990-05-15"
        issueDate="2010-05-15"
        sex="F"
        height="1,64 m"
        checkResult={DOCUMENT_CHECK_RESULT.VALID}
      />,
    );

    expect(screen.getByText("DATOS DE LA CÉDULA")).toBeOnTheScreen();
    expect(screen.getByText("Documento de cédula válido")).toBeOnTheScreen();
    expect(screen.getByText("PEPITA PEREZ")).toBeOnTheScreen();
    expect(screen.getByText("12345678")).toBeOnTheScreen();
    expect(screen.getByText("15/5/1990")).toBeOnTheScreen();
    expect(screen.getByText("15/5/2010")).toBeOnTheScreen();
    expect(screen.getByText("F")).toBeOnTheScreen();
    expect(screen.getByText("1,64 m")).toBeOnTheScreen();
  });

  it("renders the birth date from the API ISO datetime wire format", () => {
    render(
      <CedulaDataCard
        fullName="PEPITA PEREZ"
        documentNumber="12345678"
        birthDate="1990-05-15T00:00:00.000Z"
        issueDate="2010-05-15T00:00:00.000Z"
        sex="M"
        height="1,75 m"
        checkResult={DOCUMENT_CHECK_RESULT.VALID}
      />,
    );

    expect(screen.getByText("15/5/1990")).toBeOnTheScreen();
    expect(screen.getByText("15/5/2010")).toBeOnTheScreen();
  });

  it("renders raw sex and height values without reformatting", () => {
    render(
      <CedulaDataCard
        fullName="PEPITA PEREZ"
        documentNumber="12345678"
        birthDate="1990-05-15"
        issueDate="2010-05-15"
        sex="M"
        height="175 cm"
        checkResult={DOCUMENT_CHECK_RESULT.VALID}
      />,
    );

    expect(screen.getByText("M")).toBeOnTheScreen();
    expect(screen.getByText("175 cm")).toBeOnTheScreen();
  });

  it("renders placeholder dashes for missing fields instead of crashing", () => {
    render(
      <CedulaDataCard
        fullName={null}
        documentNumber={null}
        birthDate={null}
        issueDate={null}
        sex={null}
        height={null}
        checkResult={null}
      />,
    );

    expect(screen.getByText("Sin datos de cédula")).toBeOnTheScreen();
    expect(screen.getAllByText("—")).toHaveLength(6);
  });

  it("does not imply validity for a review verdict", () => {
    render(
      <CedulaDataCard
        fullName="PEPITA PEREZ"
        documentNumber="12345678"
        birthDate="1990-05-15"
        issueDate={null}
        sex={null}
        height={null}
        checkResult={DOCUMENT_CHECK_RESULT.REVIEW}
      />,
    );

    expect(screen.getByText("Requiere revisión")).toBeOnTheScreen();
    expect(screen.queryByText("Documento de cédula válido")).not.toBeOnTheScreen();
  });

  it("does not imply validity for a rejected verdict", () => {
    render(
      <CedulaDataCard
        fullName={null}
        documentNumber={null}
        birthDate={null}
        issueDate={null}
        sex={null}
        height={null}
        checkResult={DOCUMENT_CHECK_RESULT.REJECT}
      />,
    );

    expect(screen.getByText("No es una cédula válida")).toBeOnTheScreen();
    expect(screen.queryByText("Documento de cédula válido")).not.toBeOnTheScreen();
  });
});