import { ComponentFixture, TestBed } from "@angular/core/testing";
import { ExtensionNotEnabledComponent } from "./extension-not-enabled.component";

describe("ExtensionNotEnabledComponent", () => {
  let component: ExtensionNotEnabledComponent;
  let fixture: ComponentFixture<ExtensionNotEnabledComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ExtensionNotEnabledComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(ExtensionNotEnabledComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it("should create", () => {
    expect(component).toBeTruthy();
  });
});
