import en from "./locale/en";

class Locale {
  private dictionary: typeof en;

  constructor(code: string) {
    this.dictionary = languages[code as keyof typeof languages] || languages.en;
  }

  getMessage(messageName: keyof typeof languages[keyof typeof languages], variables?: Record<string, number | string>) {
    const message = this.dictionary[messageName];
    return message.replace(/\{([^}]+)}/g, (text, variable) => {
      return String(variables && variables[variable] || variable);
    });
  }

  m = this.getMessage;
}

const languages = {
  en,
};

export default Locale;