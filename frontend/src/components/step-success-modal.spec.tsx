import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { StepSuccessModal } from "./step-success-modal";

describe("StepSuccessModal", () => {
  it("shows the check mark, title, message and continue button when visible", () => {
    render(
      <StepSuccessModal
        visible
        title="Frente cargado"
        message="Siguiente paso: reverso del documento"
        onDismiss={jest.fn()}
      />,
    );

    expect(
      screen.getByLabelText("Frente cargado. Siguiente paso: reverso del documento"),
    ).toBeOnTheScreen();
    expect(screen.getByText("Frente cargado")).toBeOnTheScreen();
    expect(screen.getByText("Siguiente paso: reverso del documento")).toBeOnTheScreen();
    expect(screen.getByText("Continuar")).toBeOnTheScreen();
  });

  it("dismisses exactly once when pressing Continue repeatedly", () => {
    const onDismiss = jest.fn();

    render(
      <StepSuccessModal
        visible
        title="Frente cargado"
        message="Siguiente paso: reverso del documento"
        onDismiss={onDismiss}
      />,
    );

    const continueButton = screen.getByText("Continuar");
    fireEvent.press(continueButton);
    fireEvent.press(continueButton);
    fireEvent.press(continueButton);

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("auto-dismisses exactly once after the configured delay", () => {
    jest.useFakeTimers();
    const onDismiss = jest.fn();

    render(
      <StepSuccessModal
        visible
        title="Foto del rostro guardada"
        message="Siguiente paso: validación de identidad"
        onDismiss={onDismiss}
        autoDismissMs={1_000}
      />,
    );

    act(() => {
      jest.advanceTimersByTime(1_000);
    });
    act(() => {
      jest.advanceTimersByTime(1_000);
    });
    act(() => {
      jest.advanceTimersByTime(1_000);
    });

    expect(onDismiss).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });

  it("renders nothing when not visible", () => {
    render(
      <StepSuccessModal
        visible={false}
        title="Frente cargado"
        message="Siguiente paso: reverso del documento"
        onDismiss={jest.fn()}
      />,
    );

    expect(screen.queryByText("Continuar")).not.toBeOnTheScreen();
    expect(screen.queryByText("Frente cargado")).not.toBeOnTheScreen();
  });
});