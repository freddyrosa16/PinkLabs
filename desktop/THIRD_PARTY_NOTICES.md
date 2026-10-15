# Third-party notices

## LobeHub provider icons

The files `public/providers/claude-color.svg`, `public/providers/openai.svg`, and `public/providers/grok.svg` are copied from `@lobehub/icons-static-svg` version 1.95.1, from the [LobeHub Icons project](https://github.com/lobehub/lobe-icons). The package declares the MIT license. The license text below is from the [upstream license](https://github.com/lobehub/lobe-icons/blob/master/LICENSE).

The provider names and logos identify the selected provider. They do not indicate endorsement, affiliation, or an active model connection.

```text
MIT License

Copyright (c) 2023 LobeHub

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:
The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.
THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## GitHub Octicons

Interface icons are provided by `@primer/octicons-react` version 19.40.0 from [GitHub Octicons](https://github.com/primer/octicons). The following license is copied from the installed package.

```text
MIT License

Copyright (c) 2026 GitHub Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

Other dependencies retain their own licenses in the installed packages. This file records the copied provider assets and the interface icon library; it is not an exhaustive dependency inventory.


## Devicon programming language icons

The SVG files in `public/languages/` are copied without modification from [Devicon v2.17.0](https://github.com/devicons/devicon/tree/54cfe13ac10eaa1ef817a343ab0a9437eb3c2e08), pinned to commit `54cfe13ac10eaa1ef817a343ab0a9437eb3c2e08`. These assets ship locally with the app; rendering them does not contact a third-party image service.

| Local file | Upstream path within `icons/` |
| --- | --- |
| `javascript.svg` | `javascript/javascript-original.svg` |
| `typescript.svg` | `typescript/typescript-original.svg` |
| `python.svg` | `python/python-original.svg` |
| `html.svg` | `html5/html5-original.svg` |
| `css.svg` | `css3/css3-original.svg` |
| `go.svg` | `go/go-original.svg` |
| `rust.svg` | `rust/rust-original.svg` |
| `swift.svg` | `swift/swift-original.svg` |
| `java.svg` | `java/java-original.svg` |
| `c.svg` | `c/c-original.svg` |
| `cplusplus.svg` | `cplusplus/cplusplus-original.svg` |
| `csharp.svg` | `csharp/csharp-original.svg` |
| `ruby.svg` | `ruby/ruby-original.svg` |
| `kotlin.svg` | `kotlin/kotlin-original.svg` |
| `php.svg` | `php/php-original.svg` |
| `shell.svg` | `bash/bash-original.svg` |

Devicon distributes these files under the [MIT license](https://github.com/devicons/devicon/blob/54cfe13ac10eaa1ef817a343ab0a9437eb3c2e08/LICENSE), reproduced below. The logos identify programming languages and related technologies; their respective owners retain their trademarks. Their display does not imply endorsement or affiliation.

```text
The MIT License (MIT)

Copyright (c) 2015 konpa

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```


## Animated interface icon attribution

`src/AnimatedIcon.tsx` adapts the SVG geometry for six icons from the official [Lucide project](https://github.com/lucide-icons/lucide), pinned to commit [`7b0196e249ca09ca27c584c497aca9a8cab8a7f5`](https://github.com/lucide-icons/lucide/tree/7b0196e249ca09ca27c584c497aca9a8cab8a7f5). The icon paths and shapes are retained; React wrappers, grouping, and CSS gestures are local adaptations. No runtime icon or motion dependency is added.

| Interface use      | Original SVG                                                                                                                            |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| New Chat           | [pencil.svg](https://github.com/lucide-icons/lucide/blob/7b0196e249ca09ca27c584c497aca9a8cab8a7f5/icons/pencil.svg)                     |
| Agents             | [telescope.svg](https://github.com/lucide-icons/lucide/blob/7b0196e249ca09ca27c584c497aca9a8cab8a7f5/icons/telescope.svg)               |
| Pull Requests      | [git-pull-request.svg](https://github.com/lucide-icons/lucide/blob/7b0196e249ca09ca27c584c497aca9a8cab8a7f5/icons/git-pull-request.svg) |
| IDE                | [code.svg](https://github.com/lucide-icons/lucide/blob/7b0196e249ca09ca27c584c497aca9a8cab8a7f5/icons/code.svg)                         |
| Project folders    | [folder.svg](https://github.com/lucide-icons/lucide/blob/7b0196e249ca09ca27c584c497aca9a8cab8a7f5/icons/folder.svg)                     |
| Repository refresh | [refresh-cw.svg](https://github.com/lucide-icons/lucide/blob/7b0196e249ca09ca27c584c497aca9a8cab8a7f5/icons/refresh-cw.svg)             |

The interaction direction was informed by the user-provided [Lucide Animated](https://lucide-animated.com/) and [Its Hover](https://www.itshover.com/icons) references. Their animation implementations are not copied. The local CSS plays a small gesture once on an enabled parent button's hover or keyboard focus, then settles; reduced-motion preferences disable these gestures. Explicit loading indicators retain their existing behavior.

### Upstream Lucide license

The complete pinned [upstream license](https://github.com/lucide-icons/lucide/blob/7b0196e249ca09ca27c584c497aca9a8cab8a7f5/LICENSE) follows, including the Feather notice applicable to `code`.

```text
ISC License

Copyright (c) 2026 Lucide Icons and Contributors

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

---

The following Lucide icons are derived from the Feather project:

airplay, alert-circle, alert-octagon, alert-triangle, aperture, arrow-down-circle, arrow-down-left, arrow-down-right, arrow-down, arrow-left-circle, arrow-left, arrow-right-circle, arrow-right, arrow-up-circle, arrow-up-left, arrow-up-right, arrow-up, at-sign, calendar, cast, check, chevron-down, chevron-left, chevron-right, chevron-up, chevrons-down, chevrons-left, chevrons-right, chevrons-up, circle, clipboard, clock, code, columns, command, compass, corner-down-left, corner-down-right, corner-left-down, corner-left-up, corner-right-down, corner-right-up, corner-up-left, corner-up-right, crosshair, database, divide-circle, divide-square, dollar-sign, download, external-link, feather, frown, hash, headphones, help-circle, info, italic, key, layout, life-buoy, link-2, link, loader, lock, log-in, log-out, maximize, meh, minimize, minimize-2, minus-circle, minus-square, minus, monitor, moon, more-horizontal, more-vertical, move, music, navigation-2, navigation, octagon, pause-circle, percent, plus-circle, plus-square, plus, power, radio, rss, search, server, share, shopping-bag, sidebar, smartphone, smile, square, table-2, tablet, target, terminal, trash-2, trash, triangle, tv, type, upload, x-circle, x-octagon, x-square, x, zoom-in, zoom-out

The MIT License (MIT) (for the icons listed above)

Copyright (c) 2013-present Cole Bemis

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
