# Creating Themes

**Audience:** an owner who wants an environment in their own colours, and anyone sharing a theme with another
Coffee Pub Magpie environment.

A theme changes colours only, never the layout. Every page and every module follows it, so one theme recolours the
whole environment. Themes are made on Manage > **Theme**; only owners (and the admin) can change them.

## The seven base colours

Every theme sets these seven. The labels are the ones on Manage > Theme.

- **Page background**: behind everything.
- **Section background**: panels, popovers and the active tab.
- **Border**: outlines and dividers.
- **Text**: the body text.
- **Dim text**: secondary text, such as hints and timestamps.
- **Primary accent**: links, highlights and the main buttons.
- **Text on accent**: text and icons drawn on the primary accent, such as a main button's label.

## The optional colours and Auto

Under **Header, buttons and icons** are nine more: **Card background**, **Header background**, **Header text**,
**Icons**, **Icon hover**, **Primary accent hover**, **Secondary accent**, **Text on secondary** and **Secondary
accent hover**. Each starts on **Auto**, which works it out from the base colours, so a theme that never touches
one still looks right. Untick Auto only when you want that one thing to differ, for example a header in your own
brand colour.

## Light and dark

One theme holds both a light and a dark version. People see the environment's default, which **Dark by default**
on Manage > Theme sets, until they choose their own with the light or dark switch next to the gear at the top of
any page; their choice then stays theirs.

To make the second version, start from the first and adjust it: change the backgrounds first, then the text so it
stays readable. Keep **Text** readable on both backgrounds, and **Text on accent**
readable on **Primary accent**, in both versions.

## Preview, then Apply

The preview under the colours, with a sample header, shows the result as you change it. Nothing reaches anyone
until you choose **Apply**, which puts the theme and the default mode live on every open page at once.

**Save as new theme** keeps what you made under a new name; **Update** saves changes to the theme you started from.

## Share a theme

A theme can be saved as a file and brought into another environment.

1. To share one, choose it in the chooser and click **Export**. The browser saves `<name>.magpie-theme.json`. Any
   theme can be exported, the built-in ones and Strong Coffee included.
2. To bring one in, click **Import…** and choose the file. It is added as a new theme and chosen in the chooser, so
   you can preview it. It is not applied: click **Apply** when you want to use it.

The line beside the buttons says what came in, such as "Imported Harbour by Thomas.", and, when anything in the
file wasn't a colour Magpie knows, "Left out: ...". An import never replaces a theme: if the name is taken, it is
added as "Harbour (2)", then "(3)". A theme file can only hold colours, so importing one can't change anything else.

A file that isn't a theme, was made by a newer version of Magpie, or has neither a complete light nor a complete
dark version is refused, with a sentence saying which.

## Where to start

Strong Coffee is how Magpie has always looked. Calming Teal and Burnt Orange are the other built-in themes. Choose
one of them, change what you want, and **Save as new theme**.
