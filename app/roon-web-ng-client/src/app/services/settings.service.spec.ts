import { TestBed } from "@angular/core/testing";
import { SettingsService } from "./settings.service";

describe("SettingsService", () => {
  let service: SettingsService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(SettingsService);
  });

  it("should be created", () => {
    expect(service).toBeTruthy();
  });

  it("saves and clears the OpenAI API key", () => {
    localStorage.removeItem("nr.OPENAI_API_KEY");
    service.saveOpenAIApiKey("  sk-test  ");
    expect(service.openAIApiKey()).toBe("sk-test");
    service.saveOpenAIApiKey(" ");
    expect(service.openAIApiKey()).toBe("");
  });
});
