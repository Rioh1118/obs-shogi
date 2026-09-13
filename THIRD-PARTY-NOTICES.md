# サードパーティのライセンス表示

**このファイルは生成物。手で編集しない。**
`node scripts/generate-third-party-notices.mjs` が作り、`npm run ratchet:notices` が差分で落とす。

ObsShogi 自身のライセンスは [LICENSE.md](LICENSE.md)（MIT）。
配布しているバイナリには、以下のソフトウェアが含まれる。

## 同梱している書体

次の書体は `.woff2` の実体が配布物に載る。

- **@fontsource/lato** 5.3.0 — OFL-1.1
  - Copyright (c) 2010-2011 by tyPoland Lukasz Dziedzic (team@latofonts.com) with Reserved Font Name "Lato". Licensed under the SIL Open Font License, Version 1.1.
- **@fontsource/orbitron** 5.3.0 — OFL-1.1
  - Copyright 2018 The Orbitron Project Authors (https://github.com/theleagueof/orbitron)
- **@fontsource/zen-kaku-gothic-antique** 5.3.0 — OFL-1.1
  - Copyright 2022 The Zen Project Authors (https://github.com/googlefonts/zen-kakugothic)

## npm の依存（79 件）

`npm query .prod` が返す、配布物に載る依存。開発だけで使うものは含まない。
`os` / `cpu` / `libc` で入るかが変わるパッケージ（ネイティブの prebuilt）も含まない ——
入る1つが生成した機械で変わるうえ、配布物に載る npm のコードは `dist` に取り込まれた
JS / CSS / 書体だけで、prebuilt はビルドする機械で走るだけだから。

| パッケージ | 版 | ライセンス | 著作権表示 |
| --- | --- | --- | --- |
| @dnd-kit/accessibility | 3.1.1 | MIT | Copyright (c) 2021, Claudéric Demers |
| @dnd-kit/core | 6.3.1 | MIT | Copyright (c) 2021, Claudéric Demers |
| @dnd-kit/utilities | 3.2.2 | MIT | Copyright (c) 2021, Claudéric Demers |
| @floating-ui/core | 1.8.0 | MIT | Copyright (c) 2021-present Floating UI contributors |
| @floating-ui/dom | 1.8.0 | MIT | Copyright (c) 2021-present Floating UI contributors |
| @floating-ui/react | 0.27.20 | MIT | Copyright (c) 2021-present Floating UI contributors |
| @floating-ui/react-dom | 2.1.9 | MIT | Copyright (c) 2021-present Floating UI contributors |
| @floating-ui/utils | 0.2.12 | MIT | Copyright (c) 2021-present Floating UI contributors |
| @fontsource/lato | 5.3.0 | OFL-1.1 | Copyright (c) 2010-2011 by tyPoland Lukasz Dziedzic (team@latofonts.com) with Reserved Font Name "Lato". Licensed under the SIL Open Font License, Version 1.1. |
| @fontsource/orbitron | 5.3.0 | OFL-1.1 | Copyright 2018 The Orbitron Project Authors (https://github.com/theleagueof/orbitron) |
| @fontsource/zen-kaku-gothic-antique | 5.3.0 | OFL-1.1 | Copyright 2022 The Zen Project Authors (https://github.com/googlefonts/zen-kakugothic) |
| @lexical/clipboard | 0.41.0 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. |
| @lexical/code | 0.41.0 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. |
| @lexical/devtools-core | 0.41.0 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. |
| @lexical/dragon | 0.41.0 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. |
| @lexical/extension | 0.41.0 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. |
| @lexical/hashtag | 0.41.0 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. |
| @lexical/history | 0.41.0 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. |
| @lexical/html | 0.41.0 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. |
| @lexical/link | 0.41.0 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. |
| @lexical/list | 0.41.0 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. |
| @lexical/mark | 0.41.0 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. |
| @lexical/markdown | 0.41.0 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. |
| @lexical/offset | 0.41.0 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. |
| @lexical/overflow | 0.41.0 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. |
| @lexical/plain-text | 0.41.0 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. |
| @lexical/react | 0.41.0 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. |
| @lexical/rich-text | 0.41.0 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. |
| @lexical/selection | 0.41.0 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. |
| @lexical/table | 0.41.0 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. |
| @lexical/text | 0.41.0 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. |
| @lexical/utils | 0.41.0 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. |
| @lexical/yjs | 0.41.0 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. |
| @parcel/watcher | 2.6.0 | MIT | Copyright (c) 2017-present Devon Govett |
| @preact/signals-core | 1.14.4 | MIT | Copyright (c) 2022-present Preact Team |
| @tauri-apps/api | 2.11.1 | Apache-2.0 OR MIT | — |
| @tauri-apps/plugin-dialog | 2.7.2 | MIT OR Apache-2.0 | — |
| @tauri-apps/plugin-fs | 2.5.1 | MIT OR Apache-2.0 | — |
| @tauri-apps/plugin-opener | 2.5.4 | MIT OR Apache-2.0 | — |
| @tauri-apps/plugin-process | 2.3.1 | MIT OR Apache-2.0 | — |
| @tauri-apps/plugin-updater | 2.10.1 | MIT OR Apache-2.0 | — |
| @types/react | 19.2.18 | MIT | Copyright (c) Microsoft Corporation. |
| chokidar | 5.0.0 | MIT | Copyright (c) 2012 Paul Miller (https://paulmillr.com), Elan Shanker |
| context | 3.1.0 | MIT | Copyright (c) 2020 ealush |
| cookie-es | 3.1.1 | MIT | copyright (c) Pooya Parsa <pooya@pi0.io><br>Copyright (c) 2012-2014 Roman Shtylman <shtylman@gmail.com><br>Copyright (c) 2015 Douglas Christopher Wilson <doug@somethingdoug.com> |
| csstype | 3.2.3 | MIT | Copyright (c) 2017-2018 Fredrik Nicol |
| detect-libc | 2.1.2 | Apache-2.0 | Lovell Fuller <npm@lovell.info> |
| immutable | 5.1.9 | MIT | Copyright (c) 2014-present, Lee Byron and other contributors. |
| inherits | 2.0.3 | ISC | Copyright (c) Isaac Z. Schlueter |
| is-extglob | 2.1.1 | MIT | Copyright (c) 2014-2016, Jon Schlinkert |
| is-glob | 4.0.3 | MIT | Copyright (c) 2014-2017, Jon Schlinkert. |
| isomorphic.js | 0.2.5 | MIT | Copyright (c) 2020 Kevin Jahns <kevin.jahns@protonmail.com>. |
| json-kifu-format | 5.4.1 | MIT | Copyright (c) 2014 na2hiro (https://github.com/na2hiro) |
| lexical | 0.41.0 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. |
| lib0 | 0.2.117 | MIT | Copyright (c) 2019 Kevin Jahns <kevin.jahns@protonmail.com>. |
| lucide-react | 1.35.0 | ISC | Copyright (c) 2026 Lucide Icons and Contributors<br>Copyright (c) 2013-present Cole Bemis |
| node-addon-api | 7.1.1 | MIT | Copyright (c) 2017 [Node.js API collaborators](https://github.com/nodejs/node-addon-api#collaborators) |
| path | 0.12.7 | MIT | Joyent |
| pathe | 2.0.3 | MIT | Copyright (c) Pooya Parsa <pooya@pi0.io> - Daniel Roe <daniel@roe.dev><br>Copyright (c) 2023-present Fabio Spampinato |
| picomatch | 4.0.7 | MIT | Copyright (c) 2017-present, Jon Schlinkert. |
| prismjs | 1.30.0 | MIT | Copyright (c) 2012 Lea Verou |
| process | 0.11.10 | MIT | Copyright (c) 2013 Roman Shtylman <shtylman@gmail.com> |
| react | 19.2.8 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. |
| react-dom | 19.2.8 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. |
| react-error-boundary | 6.1.3 | MIT | Copyright (c) 2020 Brian Vaughn |
| react-router | 8.3.1 | MIT | Copyright (c) React Training LLC 2015-2019<br>Copyright (c) Remix Software Inc. 2020-2021<br>Copyright (c) Shopify Inc. 2022-2023 |
| react-window | 2.3.0 | MIT | Copyright (c) 2018 Brian Vaughn |
| readdirp | 5.1.1 | MIT | Copyright (c) 2012-2019 Thorsten Lorenz, Paul Miller (https://paulmillr.com) |
| sass | 1.103.1 | MIT | Copyright (c) 2016, Google Inc.<br>Copyright 2012, the Dart project authors.<br>Copyright 2019, the Dart project authors. |
| scheduler | 0.27.0 | MIT | Copyright (c) Meta Platforms, Inc. and affiliates. |
| shogi.js | 5.4.1 | MIT | na2hiro |
| source-map-js | 1.2.1 | BSD-3-Clause | Copyright (c) 2009-2011, Mozilla Foundation and contributors |
| tabbable | 6.5.0 | MIT | Copyright (c) 2015 David Clark |
| tslib | 2.8.1 | 0BSD | Copyright (c) Microsoft Corporation. |
| tsshogi | 2.3.4 | MIT | Copyright (c) 2023 Kubo, Ryosuke |
| util | 0.10.4 | MIT | Joyent |
| uuid | 11.1.1 | MIT | Copyright (c) 2010-2020 Robert Kieffer and other contributors |
| vest-utils | 1.5.0 | MIT | Copyright (c) 2021 ealush |
| yjs | 13.6.32 | MIT | Copyright (c) 2023 |

## Rust の依存（517 件）

`cargo metadata` の解決結果のうち、dev-dependencies を除いたもの。
配っている 4 ターゲット分の和なので、1つの OS のバイナリには載らないものも含む。

| パッケージ | 版 | ライセンス | 著作権表示 |
| --- | --- | --- | --- |
| adler2 | 2.0.0 | 0BSD OR MIT OR Apache-2.0 | Jonas Schievink <jonasschievink@gmail.com>, oyvindln <oyvindln@users.noreply.github.com> |
| aho-corasick | 1.1.3 | Unlicense OR MIT | Andrew Gallant <jamslam@gmail.com> |
| alloc-no-stdlib | 2.0.4 | BSD-3-Clause | Copyright (c) 2016 Dropbox, Inc. |
| alloc-stdlib | 0.2.2 | BSD-3-Clause | Daniel Reiter Horn <danielrh@dropbox.com> |
| anyhow | 1.0.98 | MIT OR Apache-2.0 | David Tolnay <dtolnay@gmail.com> |
| arc-swap | 1.9.2 | MIT OR Apache-2.0 | Michal 'vorner' Vaner <vorner@vorner.cz> |
| arrayvec | 0.7.6 | MIT OR Apache-2.0 | bluss |
| async-broadcast | 0.7.2 | MIT OR Apache-2.0 | Stjepan Glavina <stjepang@gmail.com>, Yoshua Wuyts <yoshuawuyts@gmail.com>, Zeeshan Ali Khan <zeeshanak@gnome.org> |
| async-channel | 2.5.0 | Apache-2.0 OR MIT | Stjepan Glavina <stjepang@gmail.com> |
| async-executor | 1.14.0 | Apache-2.0 OR MIT | Stjepan Glavina <stjepang@gmail.com>, John Nunley <dev@notgull.net> |
| async-io | 2.6.0 | Apache-2.0 OR MIT | Stjepan Glavina <stjepang@gmail.com> |
| async-lock | 3.4.2 | Apache-2.0 OR MIT | Stjepan Glavina <stjepang@gmail.com> |
| async-process | 2.5.0 | Apache-2.0 OR MIT | Stjepan Glavina <stjepang@gmail.com> |
| async-recursion | 1.1.1 | MIT OR Apache-2.0 | Robert Usher <266585+dcchut@users.noreply.github.com> |
| async-signal | 0.2.13 | Apache-2.0 OR MIT | John Nunley <dev@notgull.net> |
| async-task | 4.7.1 | Apache-2.0 OR MIT | Stjepan Glavina <stjepang@gmail.com> |
| async-trait | 0.1.88 | MIT OR Apache-2.0 | David Tolnay <dtolnay@gmail.com> |
| atk | 0.18.2 | MIT | The gtk-rs Project Developers |
| atk-sys | 0.18.2 | MIT | The gtk-rs Project Developers |
| atomic-waker | 1.1.2 | Apache-2.0 OR MIT | Stjepan Glavina <stjepang@gmail.com>, Contributors to futures-rs |
| autocfg | 1.4.0 | Apache-2.0 OR MIT | Josh Stone <cuviper@gmail.com> |
| base64 | 0.21.7 | MIT OR Apache-2.0 | Alice Maz <alice@alicemaz.com>, Marshall Pierce <marshall@mpierce.org> |
| base64 | 0.22.1 | MIT OR Apache-2.0 | Marshall Pierce <marshall@mpierce.org> |
| bit-set | 0.8.0 | Apache-2.0 OR MIT | Alexis Beingessner <a.beingessner@gmail.com> |
| bit-vec | 0.8.0 | Apache-2.0 OR MIT | Alexis Beingessner <a.beingessner@gmail.com> |
| bitflags | 1.3.2 | MIT/Apache-2.0 | The Rust Project Developers |
| bitflags | 2.13.1 | MIT OR Apache-2.0 | The Rust Project Developers |
| blake3 | 1.8.7 | CC0-1.0 OR Apache-2.0 OR Apache-2.0 WITH LLVM-exception | Jack O'Connor <oconnor663@gmail.com>, Samuel Neves |
| block-buffer | 0.10.4 | MIT OR Apache-2.0 | RustCrypto Developers |
| block2 | 0.6.1 | MIT | Mads Marquart <mads@marquart.dk> |
| blocking | 1.6.2 | Apache-2.0 OR MIT | Stjepan Glavina <stjepang@gmail.com> |
| brotli | 8.0.2 | BSD-3-Clause AND MIT | Copyright (c) 2009, 2010, 2013-2016 by the Brotli Authors. |
| brotli-decompressor | 5.0.0 | BSD-3-Clause/MIT | Copyright (c) 2016 Dropbox, Inc. |
| byteorder | 1.5.0 | Unlicense OR MIT | Andrew Gallant <jamslam@gmail.com> |
| bytes | 1.12.1 | MIT | Copyright (c) 2018 Carl Lerche |
| cairo-rs | 0.18.5 | MIT | The gtk-rs Project Developers |
| cairo-sys-rs | 0.18.2 | MIT | The gtk-rs Project Developers |
| camino | 1.1.9 | MIT OR Apache-2.0 | Without Boats <saoirse@without.boats>, Ashley Williams <ashley666ashley@gmail.com>, Steve Klabnik <steve@steveklabnik.com>, Rain <rain@sunshowers.io> |
| cargo-platform | 0.1.9 | MIT OR Apache-2.0 | — |
| cargo_metadata | 0.19.2 | MIT | Oliver Schneider <git-spam-no-reply9815368754983@oli-obk.de> |
| cargo_toml | 0.22.1 | Apache-2.0 OR MIT | Kornel <kornel@geekhood.net> |
| cc | 1.2.24 | MIT OR Apache-2.0 | Alex Crichton <alex@alexcrichton.com> |
| cfb | 0.7.3 | MIT | Copyright (c) 2017 Matthew D. Steele |
| cfg-expr | 0.15.8 | MIT OR Apache-2.0 | Embark <opensource@embark-studios.com>, Jake Shadle <jake.shadle@embark-studios.com> |
| cfg-if | 1.0.4 | MIT OR Apache-2.0 | Alex Crichton <alex@alexcrichton.com> |
| cfg_aliases | 0.2.1 | MIT | Copyright (c) 2020 Katharos Technology |
| chrono | 0.4.41 | MIT OR Apache-2.0 | Copyright (c) 2014--2025, Kang Seonghoon and<br>Copyright (c) 2014, Kang Seonghoon. |
| concurrent-queue | 2.5.0 | Apache-2.0 OR MIT | Stjepan Glavina <stjepang@gmail.com>, Taiki Endo <te316e89@gmail.com>, John Nunley <dev@notgull.net> |
| constant_time_eq | 0.4.2 | CC0-1.0 OR MIT-0 OR Apache-2.0 | Cesar Eduardo Barros <cesarb@cesarb.eti.br> |
| convert_case | 0.4.0 | MIT | David Purdum <purdum41@gmail.com> |
| cookie | 0.18.1 | MIT OR Apache-2.0 | Sergio Benitez <sb@sergio.bz>, Alex Crichton <alex@alexcrichton.com> |
| core-foundation | 0.10.0 | MIT OR Apache-2.0 | The Servo Project Developers |
| core-foundation-sys | 0.8.7 | MIT OR Apache-2.0 | The Servo Project Developers |
| core-graphics | 0.25.0 | MIT OR Apache-2.0 | The Servo Project Developers |
| core-graphics-types | 0.2.0 | MIT OR Apache-2.0 | The Servo Project Developers |
| cpufeatures | 0.2.17 | MIT OR Apache-2.0 | RustCrypto Developers |
| cpufeatures | 0.3.1 | MIT OR Apache-2.0 | RustCrypto Developers |
| crc32fast | 1.4.2 | MIT OR Apache-2.0 | Sam Rijs <srijs@airpost.net>, Alex Crichton <alex@alexcrichton.com> |
| crossbeam-channel | 0.5.15 | MIT OR Apache-2.0 | — |
| crossbeam-deque | 0.8.6 | MIT OR Apache-2.0 | — |
| crossbeam-epoch | 0.9.18 | MIT OR Apache-2.0 | — |
| crossbeam-utils | 0.8.21 | MIT OR Apache-2.0 | — |
| crypto-common | 0.1.6 | MIT OR Apache-2.0 | RustCrypto Developers |
| csa | 1.0.2 | MIT | Copyright (c) 2017 Takashi Nozawa |
| cssparser | 0.29.6 | MPL-2.0 | Simon Sapin <simon.sapin@exyr.org> |
| cssparser | 0.36.0 | MPL-2.0 | Simon Sapin <simon.sapin@exyr.org> |
| cssparser-macros | 0.6.1 | MPL-2.0 | Simon Sapin <simon.sapin@exyr.org> |
| ctor | 0.8.0 | Apache-2.0 OR MIT | Matt Mastracci <matthew@mastracci.com> |
| ctor-proc-macro | 0.0.7 | Apache-2.0 OR MIT | Matt Mastracci <matthew@mastracci.com> |
| darling | 0.20.11 | MIT | Copyright (c) 2017 Ted Driggs |
| darling_core | 0.20.11 | MIT | Copyright (c) 2017 Ted Driggs |
| darling_macro | 0.20.11 | MIT | Copyright (c) 2017 Ted Driggs |
| dashmap | 6.2.1 | MIT | Copyright (c) 2019 Acrimon |
| dbus | 0.9.12 | Apache-2.0/MIT | David Henningsson <diwic@ubuntu.com> |
| deranged | 0.5.8 | MIT OR Apache-2.0 | Jacob Pratt <jacob@jhpratt.dev> |
| derive_more | 0.99.20 | MIT | Copyright (c) 2016 Jelte Fennema |
| derive_more | 2.1.1 | MIT | Copyright (c) 2016 Jelte Fennema |
| derive_more-impl | 2.1.1 | MIT | Copyright (c) 2016 Jelte Fennema |
| digest | 0.10.7 | MIT OR Apache-2.0 | RustCrypto Developers |
| dirs | 6.0.0 | MIT OR Apache-2.0 | Simon Ochsenreither <simon@ochsenreither.de> |
| dirs-sys | 0.5.0 | MIT OR Apache-2.0 | Simon Ochsenreither <simon@ochsenreither.de> |
| dispatch2 | 0.3.0 | Zlib OR Apache-2.0 OR MIT | Mads Marquart <mads@marquart.dk>, Mary <mary@mary.zone> |
| displaydoc | 0.2.5 | MIT OR Apache-2.0 | Jane Lusby <jlusby@yaah.dev> |
| dlopen2 | 0.8.2 | MIT | Szymon Wieloch <szymon.wieloch@gmail.com>, Ahmed Masud <ahmed.masud@saf.ai>, OpenByte <development.openbyte@gmail.com> |
| dlopen2_derive | 0.4.0 | MIT | Szymon Wieloch <szymon.wieloch@gmail.com>, OpenByte <development.openbyte@gmail.com> |
| dom_query | 0.27.0 | MIT | Copyright (c) 2023 Mykola Humanov |
| dpi | 0.1.2 | Apache-2.0 AND MIT | — |
| dtoa | 1.0.10 | MIT OR Apache-2.0 | David Tolnay <dtolnay@gmail.com> |
| dtoa-short | 0.3.5 | MPL-2.0 | Xidorn Quan <me@upsuper.org> |
| dtor | 0.3.0 | Apache-2.0 OR MIT | Matt Mastracci <matthew@mastracci.com> |
| dtor-proc-macro | 0.0.6 | Apache-2.0 OR MIT | Matt Mastracci <matthew@mastracci.com> |
| dunce | 1.0.5 | CC0-1.0 OR MIT-0 OR Apache-2.0 | Kornel <kornel@geekhood.net> |
| dyn-clone | 1.0.19 | MIT OR Apache-2.0 | David Tolnay <dtolnay@gmail.com> |
| either | 1.15.0 | MIT OR Apache-2.0 | bluss |
| embed-resource | 3.0.2 | MIT | Copyright (c) 2017 nabijaczleweli |
| embed_plist | 1.2.2 | MIT OR Apache-2.0 | Nikolai Vazquez <hello@nikolaivazquez.com> |
| encoding_rs | 0.8.35 | (Apache-2.0 OR MIT) AND BSD-3-Clause | Henri Sivonen <hsivonen@hsivonen.fi> |
| endi | 1.1.0 | MIT | Zeeshan Ali Khan <zeenix@gmail.com> |
| enumflags2 | 0.7.11 | MIT OR Apache-2.0 | maik klein <maikklein@googlemail.com>, Maja Kądziołka <maya@compilercrim.es> |
| enumflags2_derive | 0.7.11 | MIT OR Apache-2.0 | maik klein <maikklein@googlemail.com>, Maja Kądziołka <maya@compilercrim.es> |
| equivalent | 1.0.2 | Apache-2.0 OR MIT | — |
| erased-serde | 0.4.6 | MIT OR Apache-2.0 | David Tolnay <dtolnay@gmail.com> |
| errno | 0.3.12 | MIT OR Apache-2.0 | Chris Wong <lambda.fairy@gmail.com>, Dan Gohman <dev@sunfishcode.online> |
| event-listener | 5.4.0 | Apache-2.0 OR MIT | Stjepan Glavina <stjepang@gmail.com>, John Nunley <dev@notgull.net> |
| event-listener-strategy | 0.5.4 | Apache-2.0 OR MIT | John Nunley <dev@notgull.net> |
| fastrand | 2.3.0 | Apache-2.0 OR MIT | Stjepan Glavina <stjepang@gmail.com> |
| fdeflate | 0.3.7 | MIT OR Apache-2.0 | The image-rs Developers |
| fern | 0.7.1 | MIT | Copyright (c) 2014-2017 David Ross |
| field-offset | 0.3.6 | MIT OR Apache-2.0 | Diggory Blake <diggsey@googlemail.com> |
| filetime | 0.2.27 | MIT/Apache-2.0 | Alex Crichton <alex@alexcrichton.com> |
| flate2 | 1.1.1 | MIT OR Apache-2.0 | Alex Crichton <alex@alexcrichton.com>, Josh Triplett <josh@joshtriplett.org> |
| fnv | 1.0.7 | Apache-2.0 / MIT | Alex Crichton <alex@alexcrichton.com> |
| foldhash | 0.2.0 | Zlib | Copyright (c) 2024 Orson Peters |
| foreign-types | 0.5.0 | MIT/Apache-2.0 | Steven Fackler <sfackler@gmail.com> |
| foreign-types-macros | 0.2.3 | MIT/Apache-2.0 | Steven Fackler <sfackler@gmail.com> |
| foreign-types-shared | 0.3.1 | MIT/Apache-2.0 | Steven Fackler <sfackler@gmail.com> |
| form_urlencoded | 1.2.1 | MIT OR Apache-2.0 | The rust-url developers |
| fsevent-sys | 4.1.0 | MIT | Copyright (c) 2015 Pierre Baillet |
| futf | 0.1.5 | MIT / Apache-2.0 | Keegan McAllister <kmcallister@mozilla.com> |
| futures-channel | 0.3.31 | MIT OR Apache-2.0 | — |
| futures-core | 0.3.31 | MIT OR Apache-2.0 | — |
| futures-executor | 0.3.31 | MIT OR Apache-2.0 | — |
| futures-io | 0.3.31 | MIT OR Apache-2.0 | — |
| futures-lite | 2.6.0 | Apache-2.0 OR MIT | Stjepan Glavina <stjepang@gmail.com>, Contributors to futures-rs |
| futures-macro | 0.3.31 | MIT OR Apache-2.0 | — |
| futures-sink | 0.3.31 | MIT OR Apache-2.0 | — |
| futures-task | 0.3.31 | MIT OR Apache-2.0 | — |
| futures-util | 0.3.31 | MIT OR Apache-2.0 | — |
| fxhash | 0.2.1 | Apache-2.0/MIT | cbreeden <github@u.breeden.cc> |
| gdk | 0.18.2 | MIT | The gtk-rs Project Developers |
| gdk-pixbuf | 0.18.5 | MIT | The gtk-rs Project Developers |
| gdk-pixbuf-sys | 0.18.0 | MIT | The gtk-rs Project Developers |
| gdk-sys | 0.18.2 | MIT | The gtk-rs Project Developers |
| gdkwayland-sys | 0.18.2 | MIT | The gtk-rs Project Developers |
| gdkx11 | 0.18.2 | MIT | The gtk-rs Project Developers |
| gdkx11-sys | 0.18.2 | MIT | The gtk-rs Project Developers |
| generic-array | 0.14.7 | MIT | Copyright (c) 2015 Bartłomiej Kamiński |
| getrandom | 0.1.16 | MIT OR Apache-2.0 | The Rand Project Developers |
| getrandom | 0.2.16 | MIT OR Apache-2.0 | The Rand Project Developers |
| getrandom | 0.3.3 | MIT OR Apache-2.0 | The Rand Project Developers |
| getrandom | 0.4.3 | MIT OR Apache-2.0 | The Rand Project Developers |
| gio | 0.18.4 | MIT | The gtk-rs Project Developers |
| gio-sys | 0.18.1 | MIT | The gtk-rs Project Developers |
| glib | 0.18.5 | MIT | The gtk-rs Project Developers |
| glib-macros | 0.18.5 | MIT | The gtk-rs Project Developers |
| glib-sys | 0.18.1 | MIT | The gtk-rs Project Developers |
| glob | 0.3.2 | MIT OR Apache-2.0 | The Rust Project Developers |
| gobject-sys | 0.18.0 | MIT | The gtk-rs Project Developers |
| gtk | 0.18.2 | MIT | The gtk-rs Project Developers |
| gtk-sys | 0.18.2 | MIT | The gtk-rs Project Developers |
| gtk3-macros | 0.18.2 | MIT | The gtk-rs Project Developers |
| hashbrown | 0.12.3 | MIT OR Apache-2.0 | Amanieu d'Antras <amanieu@gmail.com> |
| hashbrown | 0.14.5 | MIT OR Apache-2.0 | Amanieu d'Antras <amanieu@gmail.com> |
| hashbrown | 0.17.1 | MIT OR Apache-2.0 | — |
| heck | 0.4.1 | MIT OR Apache-2.0 | Without Boats <woboats@gmail.com> |
| heck | 0.5.0 | MIT OR Apache-2.0 | — |
| hex | 0.4.3 | MIT OR Apache-2.0 | KokaKiwi <kokakiwi@kokakiwi.net> |
| html5ever | 0.29.1 | MIT OR Apache-2.0 | The html5ever Project Developers |
| html5ever | 0.38.0 | MIT OR Apache-2.0 | The html5ever Project Developers |
| http | 1.3.1 | MIT OR Apache-2.0 | Alex Crichton <alex@alexcrichton.com>, Carl Lerche <me@carllerche.com>, Sean McArthur <sean@seanmonstar.com> |
| http-body | 1.0.1 | MIT | Copyright (c) 2019-2024 Sean McArthur & Hyper Contributors |
| http-body-util | 0.1.3 | MIT | Copyright (c) 2019-2025 Sean McArthur & Hyper Contributors |
| httparse | 1.10.1 | MIT OR Apache-2.0 | Sean McArthur <sean@seanmonstar.com> |
| hyper | 1.6.0 | MIT | Copyright (c) 2014-2025 Sean McArthur |
| hyper-rustls | 0.27.7 | Apache-2.0 OR ISC OR MIT | — |
| hyper-util | 0.1.12 | MIT | Copyright (c) 2023-2025 Sean McArthur |
| iana-time-zone | 0.1.63 | MIT OR Apache-2.0 | Andrew Straw <strawman@astraw.com>, René Kijewski <rene.kijewski@fu-berlin.de>, Ryan Lopopolo <rjl@hyperbo.la> |
| ico | 0.5.0 | MIT | Copyright (c) 2018 Matthew D. Steele |
| icu_collections | 2.0.0 | Unicode-3.0 | Copyright © 2020-2024 Unicode, Inc. |
| icu_locale_core | 2.0.0 | Unicode-3.0 | Copyright © 2020-2024 Unicode, Inc. |
| icu_normalizer | 2.0.0 | Unicode-3.0 | Copyright © 2020-2024 Unicode, Inc. |
| icu_normalizer_data | 2.0.0 | Unicode-3.0 | Copyright © 2020-2024 Unicode, Inc. |
| icu_properties | 2.0.1 | Unicode-3.0 | Copyright © 2020-2024 Unicode, Inc. |
| icu_properties_data | 2.0.1 | Unicode-3.0 | Copyright © 2020-2024 Unicode, Inc. |
| icu_provider | 2.0.0 | Unicode-3.0 | Copyright © 2020-2024 Unicode, Inc. |
| ident_case | 1.0.1 | MIT/Apache-2.0 | Ted Driggs <ted.driggs@outlook.com> |
| idna | 1.0.3 | MIT OR Apache-2.0 | The rust-url developers |
| idna_adapter | 1.2.1 | Apache-2.0 OR MIT | The rust-url developers |
| indexmap | 1.9.3 | Apache-2.0 OR MIT | — |
| indexmap | 2.14.1 | Apache-2.0 OR MIT | — |
| infer | 0.19.0 | MIT | Copyright (c) 2019 Bojan |
| inotify | 0.11.0 | ISC | Copyright (c) Hanno Braun and contributors |
| inotify-sys | 0.1.5 | ISC | Copyright (c) Hanno Braun and contributors |
| ipnet | 2.11.0 | MIT OR Apache-2.0 | Kris Price <kris@krisprice.nz> |
| iri-string | 0.7.10 | MIT OR Apache-2.0 | YOSHIOKA Takuma <nop_thread@nops.red> |
| is-docker | 0.2.0 | MIT | Copyright (c) 2023 Sean Larkin |
| is-wsl | 0.4.0 | MIT | Copyright (c) 2023 Sean Larkin |
| itertools | 0.10.5 | MIT/Apache-2.0 | bluss |
| itoa | 1.0.15 | MIT OR Apache-2.0 | David Tolnay <dtolnay@gmail.com> |
| javascriptcore-rs | 1.1.2 | MIT | Copyright (c) 2013-2021, The Gtk-rs Project Developers.<br>Copyright (c) 2021, Tauri Programme within The Commons Conservancy. |
| javascriptcore-rs-sys | 1.1.1 | MIT | Copyright (c) 2013-2017, The Gtk-rs Project Developers. |
| jobserver | 0.1.34 | MIT OR Apache-2.0 | Alex Crichton <alex@alexcrichton.com> |
| json-patch | 3.0.1 | MIT/Apache-2.0 | Ivan Dubrov <dubrov.ivan@gmail.com> |
| jsonptr | 0.6.3 | MIT OR Apache-2.0 | chance dinkins, André Sá de Mello <codasm@pm.me> |
| keyboard-types | 0.7.0 | MIT OR Apache-2.0 | Pyfisch <pyfisch@posteo.org> |
| kuchikiki | 0.8.8-speedreader | MIT | Brave Authors, Ralph Giles <rgiles@brave.com>, Simon Sapin <simon.sapin@exyr.org> |
| libappindicator | 0.9.0 | Apache-2.0 OR MIT | — |
| libappindicator-sys | 0.9.0 | Apache-2.0 OR MIT | — |
| libc | 0.2.189 | MIT OR Apache-2.0 | — |
| libdbus-sys | 0.2.7 | Apache-2.0/MIT | David Henningsson <diwic@ubuntu.com> |
| libloading | 0.7.4 | ISC | Copyright © 2015, Simonas Kazlauskas |
| linux-raw-sys | 0.12.1 | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT | Dan Gohman <dev@sunfishcode.online> |
| litemap | 0.8.0 | Unicode-3.0 | Copyright © 2020-2024 Unicode, Inc. |
| lock_api | 0.4.14 | MIT OR Apache-2.0 | Amanieu d'Antras <amanieu@gmail.com> |
| log | 0.4.34 | MIT OR Apache-2.0 | The Rust Project Developers |
| mac | 0.1.1 | MIT/Apache-2.0 | Jonathan Reem <jonathan.reem@gmail.com> |
| markup5ever | 0.14.1 | MIT OR Apache-2.0 | The html5ever Project Developers |
| markup5ever | 0.38.0 | MIT OR Apache-2.0 | The html5ever Project Developers |
| match_token | 0.1.0 | MIT OR Apache-2.0 | — |
| matches | 0.1.10 | MIT | Copyright (c) 2014-2016 Simon Sapin |
| memchr | 2.7.4 | Unlicense OR MIT | Andrew Gallant <jamslam@gmail.com>, bluss |
| memoffset | 0.9.1 | MIT | Copyright (c) 2017 Gilad Naaman |
| mime | 0.3.17 | MIT OR Apache-2.0 | Sean McArthur <sean@seanmonstar.com> |
| minimal-lexical | 0.2.1 | MIT/Apache-2.0 | Copyright (c) 2009 The Go Authors. All rights reserved. |
| minisign-verify | 0.2.5 | MIT | Copyright (c) 2019-2025 Frank Denis<br>Copyright (c) 2006-2009 Graydon Hoare<br>Copyright (c) 2009-2013 Mozilla Foundation |
| miniz_oxide | 0.8.8 | MIT OR Zlib OR Apache-2.0 | Copyright 2013-2014 RAD Game Tools and Valve Software<br>Copyright 2010-2014 Rich Geldreich and Tenacious Software LLC<br>Copyright (c) 2017 Frommi |
| mio | 1.0.3 | MIT | Copyright (c) 2014 Carl Lerche and other MIO contributors |
| muda | 0.19.3 | Apache-2.0 OR MIT | — |
| new_debug_unreachable | 1.0.6 | MIT | Matt Brubeck <mbrubeck@limpet.net>, Jonathan Reem <jonathan.reem@gmail.com> |
| nodrop | 0.1.14 | MIT/Apache-2.0 | bluss |
| nom | 7.1.3 | MIT | Copyright (c) 2014-2019 Geoffroy Couprie |
| notify | 8.2.0 | CC0-1.0 | Félix Saparelli <me@passcod.name>, Daniel Faust <hessijames@gmail.com>, Aron Heinecke <Ox0p54r36@t-online.de> |
| notify-types | 2.1.0 | MIT OR Apache-2.0 | Daniel Faust <hessijames@gmail.com> |
| ntapi | 0.4.1 | Apache-2.0 OR MIT | MSxDOS <melcodos@gmail.com> |
| num-conv | 0.2.2 | MIT OR Apache-2.0 | Jacob Pratt <jacob@jhpratt.dev> |
| num-traits | 0.2.19 | MIT OR Apache-2.0 | The Rust Project Developers |
| num_threads | 0.1.7 | MIT OR Apache-2.0 | Jacob Pratt <open-source@jhpratt.dev> |
| objc2 | 0.6.4 | MIT | Mads Marquart <mads@marquart.dk> |
| objc2-app-kit | 0.3.1 | Zlib OR Apache-2.0 OR MIT | — |
| objc2-core-foundation | 0.3.1 | Zlib OR Apache-2.0 OR MIT | — |
| objc2-core-graphics | 0.3.1 | Zlib OR Apache-2.0 OR MIT | — |
| objc2-encode | 4.1.0 | MIT | Mads Marquart <mads@marquart.dk> |
| objc2-exception-helper | 0.1.1 | Zlib OR Apache-2.0 OR MIT | Mads Marquart <mads@marquart.dk> |
| objc2-foundation | 0.3.1 | MIT | — |
| objc2-io-kit | 0.3.1 | Zlib OR Apache-2.0 OR MIT | — |
| objc2-io-surface | 0.3.1 | Zlib OR Apache-2.0 OR MIT | — |
| objc2-osa-kit | 0.3.1 | Zlib OR Apache-2.0 OR MIT | — |
| objc2-web-kit | 0.3.1 | Zlib OR Apache-2.0 OR MIT | — |
| once_cell | 1.21.4 | MIT OR Apache-2.0 | Aleksey Kladov <aleksey.kladov@gmail.com> |
| open | 5.3.3 | MIT | Copyright © `2015` `Sebastian Thiel` |
| openssl-probe | 0.2.1 | MIT OR Apache-2.0 | Alex Crichton <alex@alexcrichton.com> |
| option-ext | 0.2.0 | MPL-2.0 | Simon Ochsenreither <simon@ochsenreither.de> |
| ordered-stream | 0.2.0 | MIT OR Apache-2.0 | Daniel De Graaf <code@danieldg.net>, Zeeshan Ali Khan <zeeshanak@gnome.org> |
| osakit | 0.3.1 | MIT OR Apache-2.0 | Marat Dulin <mdevils@gmail.com> |
| pango | 0.18.3 | MIT | The gtk-rs Project Developers |
| pango-sys | 0.18.0 | MIT | The gtk-rs Project Developers |
| parking | 2.2.1 | Apache-2.0 OR MIT | Stjepan Glavina <stjepang@gmail.com>, The Rust Project Developers |
| parking_lot | 0.12.5 | MIT OR Apache-2.0 | Amanieu d'Antras <amanieu@gmail.com> |
| parking_lot_core | 0.9.12 | MIT OR Apache-2.0 | Amanieu d'Antras <amanieu@gmail.com> |
| pathdiff | 0.2.3 | MIT/Apache-2.0 | Manish Goregaokar <manishsmail@gmail.com> |
| percent-encoding | 2.3.1 | MIT OR Apache-2.0 | The rust-url developers |
| phf | 0.10.1 | MIT | Steven Fackler <sfackler@gmail.com> |
| phf | 0.11.3 | MIT | Copyright (c) 2014-2022 Steven Fackler, Yuki Okushi |
| phf | 0.13.1 | MIT | Copyright (c) 2014-2022 Steven Fackler, Yuki Okushi |
| phf | 0.8.0 | MIT | Steven Fackler <sfackler@gmail.com> |
| phf_codegen | 0.11.3 | MIT | Copyright (c) 2014-2022 Steven Fackler, Yuki Okushi |
| phf_codegen | 0.13.1 | MIT | Copyright (c) 2014-2022 Steven Fackler, Yuki Okushi |
| phf_codegen | 0.8.0 | MIT | Steven Fackler <sfackler@gmail.com> |
| phf_generator | 0.10.0 | MIT | Steven Fackler <sfackler@gmail.com> |
| phf_generator | 0.11.3 | MIT | Copyright (c) 2014-2022 Steven Fackler, Yuki Okushi |
| phf_generator | 0.13.1 | MIT | Copyright (c) 2014-2022 Steven Fackler, Yuki Okushi |
| phf_generator | 0.8.0 | MIT | Steven Fackler <sfackler@gmail.com> |
| phf_macros | 0.10.0 | MIT | Steven Fackler <sfackler@gmail.com> |
| phf_macros | 0.13.1 | MIT | Copyright (c) 2014-2022 Steven Fackler, Yuki Okushi |
| phf_shared | 0.10.0 | MIT | Steven Fackler <sfackler@gmail.com> |
| phf_shared | 0.11.3 | MIT | Copyright (c) 2014-2022 Steven Fackler, Yuki Okushi |
| phf_shared | 0.13.1 | MIT | Copyright (c) 2014-2022 Steven Fackler, Yuki Okushi |
| phf_shared | 0.8.0 | MIT | Steven Fackler <sfackler@gmail.com> |
| pin-project-lite | 0.2.16 | Apache-2.0 OR MIT | — |
| pin-utils | 0.1.0 | MIT OR Apache-2.0 | Josef Brandl <mail@josefbrandl.de> |
| piper | 0.2.4 | MIT OR Apache-2.0 | Stjepan Glavina <stjepang@gmail.com>, John Nunley <dev@notgull.net> |
| pkg-config | 0.3.32 | MIT OR Apache-2.0 | Alex Crichton <alex@alexcrichton.com> |
| plist | 1.7.1 | MIT | Copyright (c) 2015 Edward Barnard |
| png | 0.17.16 | MIT OR Apache-2.0 | The image-rs Developers |
| png | 0.18.1 | MIT OR Apache-2.0 | The image-rs Developers |
| polling | 3.11.0 | Apache-2.0 OR MIT | Stjepan Glavina <stjepang@gmail.com>, John Nunley <dev@notgull.net> |
| potential_utf | 0.1.2 | Unicode-3.0 | Copyright © 2020-2024 Unicode, Inc. |
| powerfmt | 0.2.0 | MIT OR Apache-2.0 | Jacob Pratt <jacob@jhpratt.dev> |
| ppv-lite86 | 0.2.21 | MIT OR Apache-2.0 | The CryptoCorrosion Contributors |
| precomputed-hash | 0.1.1 | MIT | Copyright (c) 2017 Emilio Cobos Álvarez |
| proc-macro-crate | 1.3.1 | MIT OR Apache-2.0 | Bastian Köcher <git@kchr.de> |
| proc-macro-crate | 2.0.0 | MIT OR Apache-2.0 | Bastian Köcher <git@kchr.de> |
| proc-macro-crate | 3.3.0 | MIT OR Apache-2.0 | Bastian Köcher <git@kchr.de> |
| proc-macro-error | 1.0.4 | MIT OR Apache-2.0 | CreepySkeleton <creepy-skeleton@yandex.ru> |
| proc-macro-error-attr | 1.0.4 | MIT OR Apache-2.0 | CreepySkeleton <creepy-skeleton@yandex.ru> |
| proc-macro-hack | 0.5.20+deprecated | MIT OR Apache-2.0 | David Tolnay <dtolnay@gmail.com> |
| proc-macro2 | 1.0.95 | MIT OR Apache-2.0 | David Tolnay <dtolnay@gmail.com>, Alex Crichton <alex@alexcrichton.com> |
| quick-xml | 0.32.0 | MIT | — |
| quote | 1.0.40 | MIT OR Apache-2.0 | David Tolnay <dtolnay@gmail.com> |
| rand | 0.7.3 | MIT OR Apache-2.0 | The Rand Project Developers, The Rust Project Developers |
| rand | 0.8.5 | MIT OR Apache-2.0 | The Rand Project Developers, The Rust Project Developers |
| rand_chacha | 0.2.2 | MIT OR Apache-2.0 | The Rand Project Developers, The Rust Project Developers, The CryptoCorrosion Contributors |
| rand_chacha | 0.3.1 | MIT OR Apache-2.0 | The Rand Project Developers, The Rust Project Developers, The CryptoCorrosion Contributors |
| rand_core | 0.5.1 | MIT OR Apache-2.0 | The Rand Project Developers, The Rust Project Developers |
| rand_core | 0.6.4 | MIT OR Apache-2.0 | The Rand Project Developers, The Rust Project Developers |
| rand_pcg | 0.2.1 | MIT OR Apache-2.0 | The Rand Project Developers |
| raw-window-handle | 0.6.2 | MIT OR Apache-2.0 OR Zlib | Osspial <osspial@gmail.com> |
| rayon | 1.12.0 | MIT OR Apache-2.0 | — |
| rayon-core | 1.13.0 | MIT OR Apache-2.0 | — |
| regex | 1.11.1 | MIT OR Apache-2.0 | The Rust Project Developers, Andrew Gallant <jamslam@gmail.com> |
| regex-automata | 0.4.9 | MIT OR Apache-2.0 | The Rust Project Developers, Andrew Gallant <jamslam@gmail.com> |
| regex-syntax | 0.8.5 | MIT OR Apache-2.0 | The Rust Project Developers, Andrew Gallant <jamslam@gmail.com> |
| reqwest | 0.13.2 | MIT OR Apache-2.0 | Sean McArthur <sean@seanmonstar.com> |
| rfd | 0.16.0 | MIT | Copyright (c) 2022 Bartłomiej Maryńczak |
| ring | 0.17.14 | Apache-2.0 AND ISC | — |
| rustc-hash | 2.1.3 | Apache-2.0 OR MIT | The Rust Project Developers |
| rustc_version | 0.4.1 | MIT OR Apache-2.0 | — |
| rustix | 1.1.4 | Apache-2.0 WITH LLVM-exception OR Apache-2.0 OR MIT | Dan Gohman <dev@sunfishcode.online>, Jakub Konka <kubkon@jakubkonka.com> |
| rustls | 0.23.37 | Apache-2.0 OR ISC OR MIT | — |
| rustls-native-certs | 0.8.4 | Apache-2.0 OR ISC OR MIT | — |
| rustls-pki-types | 1.14.0 | MIT OR Apache-2.0 | — |
| rustls-platform-verifier | 0.6.2 | MIT OR Apache-2.0 | — |
| rustls-webpki | 0.103.15 | ISC | Copyright 2015 Brian Smith. |
| rustversion | 1.0.21 | MIT OR Apache-2.0 | David Tolnay <dtolnay@gmail.com> |
| same-file | 1.0.6 | Unlicense/MIT | Andrew Gallant <jamslam@gmail.com> |
| schemars | 0.8.22 | MIT | Copyright (c) 2019 Graham Esau |
| schemars_derive | 0.8.22 | MIT | Copyright (c) 2019 Graham Esau |
| scopeguard | 1.2.0 | MIT OR Apache-2.0 | bluss |
| security-framework | 3.7.0 | MIT OR Apache-2.0 | Steven Fackler <sfackler@gmail.com>, Kornel <kornel@geekhood.net> |
| security-framework-sys | 2.17.0 | MIT OR Apache-2.0 | Steven Fackler <sfackler@gmail.com>, Kornel <kornel@geekhood.net> |
| selectors | 0.24.0 | MPL-2.0 | The Servo Project Developers |
| selectors | 0.36.1 | MPL-2.0 | The Servo Project Developers |
| semver | 1.0.26 | MIT OR Apache-2.0 | David Tolnay <dtolnay@gmail.com> |
| serde | 1.0.229 | MIT OR Apache-2.0 | Erick Tryzelaar <erick.tryzelaar@gmail.com>, David Tolnay <dtolnay@gmail.com> |
| serde-untagged | 0.1.7 | MIT OR Apache-2.0 | David Tolnay <dtolnay@gmail.com> |
| serde_core | 1.0.229 | MIT OR Apache-2.0 | Erick Tryzelaar <erick.tryzelaar@gmail.com>, David Tolnay <dtolnay@gmail.com> |
| serde_derive | 1.0.229 | MIT OR Apache-2.0 | Erick Tryzelaar <erick.tryzelaar@gmail.com>, David Tolnay <dtolnay@gmail.com> |
| serde_derive_internals | 0.29.1 | MIT OR Apache-2.0 | Erick Tryzelaar <erick.tryzelaar@gmail.com>, David Tolnay <dtolnay@gmail.com> |
| serde_json | 1.0.151 | MIT OR Apache-2.0 | Erick Tryzelaar <erick.tryzelaar@gmail.com>, David Tolnay <dtolnay@gmail.com> |
| serde_repr | 0.1.20 | MIT OR Apache-2.0 | David Tolnay <dtolnay@gmail.com> |
| serde_spanned | 0.6.8 | MIT OR Apache-2.0 | — |
| serde_spanned | 1.1.1 | MIT OR Apache-2.0 | — |
| serde_with | 3.12.0 | MIT OR Apache-2.0 | Jonas Bushart, Marcin Kaźmierczak |
| serde_with_macros | 3.12.0 | MIT OR Apache-2.0 | Jonas Bushart |
| serialize-to-javascript | 0.1.2 | MIT OR Apache-2.0 | Chip Reed <chip@chip.sh> |
| serialize-to-javascript-impl | 0.1.2 | MIT OR Apache-2.0 | Chip Reed <chip@chip.sh> |
| servo_arc | 0.2.0 | MIT OR Apache-2.0 | The Servo Project Developers |
| servo_arc | 0.4.3 | MIT OR Apache-2.0 | The Servo Project Developers |
| sha2 | 0.10.9 | MIT OR Apache-2.0 | RustCrypto Developers |
| shlex | 1.3.0 | MIT OR Apache-2.0 | comex <comexk@gmail.com>, Fenhl <fenhl@fenhl.net>, Adrian Taylor <adetaylor@chromium.org>, Alex Touchet <alextouchet@outlook.com>, Daniel Parks <dp+git@oxidized.org>, Garrett Berg <googberg@gmail.com> |
| shogi-kifu-converter | 0.5.0 | MIT | Copyright (c) 2022 Yoshihiro Sugi |
| shogi_core | 0.1.5 | MIT | Rust shogi crates developers |
| shogi_legality_lite | 0.1.3 | MIT | Rust shogi crates developers |
| shogi_official_kifu | 0.1.2 | MIT | Rust shogi crates developers |
| signal-hook-registry | 1.4.5 | Apache-2.0/MIT | Michal 'vorner' Vaner <vorner@vorner.cz>, Masaki Hara <ackie.h.gmai@gmail.com> |
| simd-adler32 | 0.3.7 | MIT | Copyright (c) [2021] [Marvin Countryman] |
| siphasher | 0.3.11 | MIT/Apache-2.0 | Copyright 2012-2016 The Rust Project Developers.<br>Copyright 2016-2023 Frank Denis. |
| siphasher | 1.0.1 | MIT/Apache-2.0 | Copyright 2012-2016 The Rust Project Developers.<br>Copyright 2016-2024 Frank Denis. |
| slab | 0.4.9 | MIT | Copyright (c) 2019 Carl Lerche |
| smallvec | 1.15.0 | MIT OR Apache-2.0 | The Servo Project Developers |
| socket2 | 0.5.9 | MIT OR Apache-2.0 | Alex Crichton <alex@alexcrichton.com>, Thomas de Zeeuw <thomasdezeeuw@gmail.com> |
| socket2 | 0.6.5 | MIT OR Apache-2.0 | Alex Crichton <alex@alexcrichton.com>, Thomas de Zeeuw <thomasdezeeuw@gmail.com> |
| softbuffer | 0.4.6 | MIT OR Apache-2.0 | — |
| soup3 | 0.5.0 | MIT | Copyright (c) 2013-2017, The Gtk-rs Project Developers. |
| soup3-sys | 0.5.0 | MIT | Copyright (c) 2013-2017, The Gtk-rs Project Developers. |
| stable_deref_trait | 1.2.0 | MIT/Apache-2.0 | Robert Grosse <n210241048576@gmail.com> |
| string_cache | 0.8.9 | MIT OR Apache-2.0 | The Servo Project Developers |
| string_cache | 0.9.0 | MIT OR Apache-2.0 | The Servo Project Developers |
| string_cache_codegen | 0.5.4 | MIT OR Apache-2.0 | The Servo Project Developers |
| string_cache_codegen | 0.6.1 | MIT OR Apache-2.0 | The Servo Project Developers |
| strsim | 0.11.1 | MIT | Copyright (c) 2015 Danny Guo<br>Copyright (c) 2016 Titus Wormer <tituswormer@gmail.com><br>Copyright (c) 2018 Akash Kurdekar |
| subtle | 2.6.1 | BSD-3-Clause | Copyright (c) 2016-2017 Isis Agora Lovecruft, Henry de Valence. All rights reserved.<br>Copyright (c) 2016-2024 Isis Agora Lovecruft. All rights reserved. |
| swift-rs | 1.0.7 | MIT OR Apache-2.0 | The swift-rs contributors |
| syn | 1.0.109 | MIT OR Apache-2.0 | David Tolnay <dtolnay@gmail.com> |
| syn | 2.0.101 | MIT OR Apache-2.0 | David Tolnay <dtolnay@gmail.com> |
| syn | 3.0.4 | MIT OR Apache-2.0 | David Tolnay <dtolnay@gmail.com> |
| sync_wrapper | 1.0.2 | Apache-2.0 | Actyx AG <developer@actyx.io> |
| synstructure | 0.13.2 | MIT | Copyright 2016 Nika Layzell |
| sysinfo | 0.38.3 | MIT | Copyright (c) 2015 Guillaume Gomez |
| system-deps | 6.2.2 | MIT OR Apache-2.0 | Guillaume Desmottes <guillaume.desmottes@collabora.com>, Josh Triplett <josh@joshtriplett.org> |
| tao | 0.35.3 | Apache-2.0 | Tauri Programme within The Commons Conservancy, The winit contributors |
| tar | 0.4.46 | MIT OR Apache-2.0 | Alex Crichton <alex@alexcrichton.com> |
| target-lexicon | 0.12.16 | Apache-2.0 WITH LLVM-exception | Dan Gohman <sunfish@mozilla.com> |
| tauri | 2.11.1 | Apache-2.0 OR MIT | Tauri Programme within The Commons Conservancy |
| tauri-build | 2.6.3 | Apache-2.0 OR MIT | Tauri Programme within The Commons Conservancy |
| tauri-codegen | 2.6.3 | Apache-2.0 OR MIT | Tauri Programme within The Commons Conservancy |
| tauri-macros | 2.6.3 | Apache-2.0 OR MIT | Tauri Programme within The Commons Conservancy |
| tauri-plugin | 2.5.4 | Apache-2.0 OR MIT | Tauri Programme within The Commons Conservancy |
| tauri-plugin-dialog | 2.7.2 | Apache-2.0 OR MIT | Tauri Programme within The Commons Conservancy |
| tauri-plugin-fs | 2.5.1 | Apache-2.0 OR MIT | Tauri Programme within The Commons Conservancy |
| tauri-plugin-log | 2.9.0 | Apache-2.0 OR MIT | Tauri Programme within The Commons Conservancy |
| tauri-plugin-opener | 2.5.4 | Apache-2.0 OR MIT | Tauri Programme within The Commons Conservancy |
| tauri-plugin-process | 2.3.1 | Apache-2.0 OR MIT | Tauri Programme within The Commons Conservancy |
| tauri-plugin-updater | 2.10.1 | Apache-2.0 OR MIT | Tauri Programme within The Commons Conservancy |
| tauri-runtime | 2.11.3 | Apache-2.0 OR MIT | Tauri Programme within The Commons Conservancy |
| tauri-runtime-wry | 2.11.4 | Apache-2.0 OR MIT | Tauri Programme within The Commons Conservancy |
| tauri-utils | 2.9.3 | Apache-2.0 OR MIT | Tauri Programme within The Commons Conservancy |
| tauri-winres | 0.3.1 | MIT | Copyright (c) 2023 - Present Tauri Apps Contributors<br>Copyright (c) 2016 Max Resch |
| tempfile | 3.20.0 | MIT OR Apache-2.0 | Steven Allen <steven@stebalien.com>, The Rust Project Developers, Ashley Mannix <ashleymannix@live.com.au>, Jason White <me@jasonwhite.io> |
| tendril | 0.4.3 | MIT/Apache-2.0 | Keegan McAllister <mcallister.keegan@gmail.com>, Simon Sapin <simon.sapin@exyr.org>, Chris Morgan <me@chrismorgan.info> |
| tendril | 0.5.1 | MIT OR Apache-2.0 | Keegan McAllister <mcallister.keegan@gmail.com>, Simon Sapin <simon.sapin@exyr.org>, Chris Morgan <me@chrismorgan.info> |
| thiserror | 1.0.69 | MIT OR Apache-2.0 | David Tolnay <dtolnay@gmail.com> |
| thiserror | 2.0.20 | MIT OR Apache-2.0 | David Tolnay <dtolnay@gmail.com> |
| thiserror-impl | 1.0.69 | MIT OR Apache-2.0 | David Tolnay <dtolnay@gmail.com> |
| thiserror-impl | 2.0.20 | MIT OR Apache-2.0 | David Tolnay <dtolnay@gmail.com> |
| time | 0.3.55 | MIT OR Apache-2.0 | Jacob Pratt <open-source@jhpratt.dev>, Time contributors |
| time-core | 0.1.9 | MIT OR Apache-2.0 | Jacob Pratt <open-source@jhpratt.dev>, Time contributors |
| time-macros | 0.2.32 | MIT OR Apache-2.0 | Jacob Pratt <open-source@jhpratt.dev>, Time contributors |
| tinystr | 0.8.1 | Unicode-3.0 | Copyright © 2020-2024 Unicode, Inc. |
| tokio | 1.50.0 | MIT | Copyright (c) Tokio Contributors |
| tokio-macros | 2.6.1 | MIT | Copyright (c) 2019 Yoshua Wuyts<br>Copyright (c) Tokio Contributors |
| tokio-rustls | 0.26.4 | MIT OR Apache-2.0 | — |
| tokio-util | 0.7.19 | MIT | Copyright (c) Tokio Contributors |
| toml | 0.8.22 | MIT OR Apache-2.0 | Alex Crichton <alex@alexcrichton.com> |
| toml | 0.9.6 | MIT OR Apache-2.0 | — |
| toml | 1.1.4+spec-1.1.0 | MIT OR Apache-2.0 | — |
| toml_datetime | 0.6.9 | MIT OR Apache-2.0 | Alex Crichton <alex@alexcrichton.com> |
| toml_datetime | 0.7.5+spec-1.1.0 | MIT OR Apache-2.0 | — |
| toml_datetime | 1.1.1+spec-1.1.0 | MIT OR Apache-2.0 | — |
| toml_edit | 0.19.15 | MIT OR Apache-2.0 | Andronik Ordian <write@reusable.software>, Ed Page <eopage@gmail.com> |
| toml_edit | 0.20.7 | MIT OR Apache-2.0 | Andronik Ordian <write@reusable.software>, Ed Page <eopage@gmail.com> |
| toml_edit | 0.22.26 | MIT OR Apache-2.0 | Andronik Ordian <write@reusable.software>, Ed Page <eopage@gmail.com> |
| toml_parser | 1.1.3+spec-1.1.0 | MIT OR Apache-2.0 | — |
| toml_write | 0.1.1 | MIT OR Apache-2.0 | — |
| toml_writer | 1.1.2+spec-1.1.0 | MIT OR Apache-2.0 | — |
| tower | 0.5.2 | MIT | Copyright (c) 2019 Tower Contributors |
| tower-http | 0.6.8 | MIT | Copyright (c) 2019-2021 Tower Contributors |
| tower-layer | 0.3.3 | MIT | Copyright (c) 2019 Tower Contributors |
| tower-service | 0.3.3 | MIT | Copyright (c) 2019 Tower Contributors |
| tracing | 0.1.41 | MIT | Copyright (c) 2019 Tokio Contributors |
| tracing-attributes | 0.1.28 | MIT | Copyright (c) 2019 Tokio Contributors |
| tracing-core | 0.1.33 | MIT | Copyright (c) 2019 Tokio Contributors |
| tray-icon | 0.23.1 | MIT OR Apache-2.0 | — |
| try-lock | 0.2.5 | MIT | Copyright (c) 2018-2023 Sean McArthur<br>Copyright (c) 2016 Alex Crichton |
| typeid | 1.0.3 | MIT OR Apache-2.0 | David Tolnay <dtolnay@gmail.com> |
| typenum | 1.18.0 | MIT OR Apache-2.0 | Paho Lurie-Gregg <paho@paholg.com>, Andre Bogus <bogusandre@gmail.com> |
| unic-char-property | 0.9.0 | MIT/Apache-2.0 | The UNIC Project Developers |
| unic-char-range | 0.9.0 | MIT/Apache-2.0 | The UNIC Project Developers |
| unic-common | 0.9.0 | MIT/Apache-2.0 | The UNIC Project Developers |
| unic-ucd-ident | 0.9.0 | MIT/Apache-2.0 | The UNIC Project Developers |
| unic-ucd-version | 0.9.0 | MIT/Apache-2.0 | The UNIC Project Developers |
| unicode-ident | 1.0.18 | (MIT OR Apache-2.0) AND Unicode-3.0 | David Tolnay <dtolnay@gmail.com> |
| unicode-segmentation | 1.12.0 | MIT OR Apache-2.0 | kwantam <kwantam@gmail.com>, Manish Goregaokar <manishsmail@gmail.com> |
| untrusted | 0.9.0 | ISC | Copyright 2015-2016 Brian Smith. |
| url | 2.5.4 | MIT OR Apache-2.0 | The rust-url developers |
| urlpattern | 0.3.0 | MIT | Copyright (c) 2021 the Deno authors |
| usi | 0.6.2 | MIT | Copyright (c) 2017 Takashi Nozawa |
| utf-8 | 0.7.6 | MIT OR Apache-2.0 | Simon Sapin <simon.sapin@exyr.org> |
| utf8_iter | 1.0.4 | Apache-2.0 OR MIT | Henri Sivonen <hsivonen@hsivonen.fi> |
| uuid | 1.25.0 | Apache-2.0 OR MIT | Ashley Mannix<ashleymannix@live.com.au>, Dylan DPC<dylan.dpc@gmail.com>, Hunar Roop Kahlon<hunar.roop@gmail.com> |
| version-compare | 0.2.0 | MIT | Copyright (c) 2017 Tim Visée |
| version_check | 0.9.5 | MIT/Apache-2.0 | Sergio Benitez <sb@sergio.bz> |
| vswhom | 0.1.0 | MIT | Copyright (c) 2019 nabijaczleweli |
| vswhom-sys | 0.1.3 | MIT | Copyright (c) 2019 nabijaczleweli |
| walkdir | 2.5.0 | Unlicense/MIT | Andrew Gallant <jamslam@gmail.com> |
| want | 0.3.1 | MIT | Copyright (c) 2018-2019 Sean McArthur |
| web_atoms | 0.2.6 | MIT OR Apache-2.0 | The html5ever Project Developers |
| webkit2gtk | 2.0.2 | MIT | Copyright (c) 2016 Boucher, Antoni <bouanto@zoho.com><br>Copyright (c) 2017-2021, The Gtk-rs Project Developers.<br>Copyright (c) 2021, Tauri Programme within The Commons Conservancy |
| webkit2gtk-sys | 2.0.2 | MIT | Copyright (c) 2016 Boucher, Antoni <bouanto@zoho.com> |
| webview2-com | 0.38.2 | MIT | — |
| webview2-com-macros | 0.8.1 | MIT | — |
| webview2-com-sys | 0.38.2 | MIT | — |
| winapi | 0.3.9 | MIT/Apache-2.0 | Peter Atashian <retep998@gmail.com> |
| winapi-util | 0.1.9 | Unlicense OR MIT | Andrew Gallant <jamslam@gmail.com> |
| window-vibrancy | 0.6.0 | Apache-2.0 OR MIT | Tauri Programme within The Commons Conservancy |
| windows | 0.61.1 | MIT OR Apache-2.0 | Microsoft |
| windows | 0.62.2 | MIT OR Apache-2.0 | — |
| windows-collections | 0.2.0 | MIT OR Apache-2.0 | — |
| windows-collections | 0.3.2 | MIT OR Apache-2.0 | — |
| windows-core | 0.61.2 | MIT OR Apache-2.0 | Microsoft |
| windows-core | 0.62.2 | MIT OR Apache-2.0 | — |
| windows-future | 0.2.1 | MIT OR Apache-2.0 | — |
| windows-future | 0.3.2 | MIT OR Apache-2.0 | — |
| windows-implement | 0.60.2 | MIT OR Apache-2.0 | — |
| windows-interface | 0.59.3 | MIT OR Apache-2.0 | — |
| windows-link | 0.1.1 | MIT OR Apache-2.0 | Microsoft |
| windows-link | 0.2.1 | MIT OR Apache-2.0 | — |
| windows-numerics | 0.2.0 | MIT OR Apache-2.0 | — |
| windows-numerics | 0.3.1 | MIT OR Apache-2.0 | — |
| windows-result | 0.3.4 | MIT OR Apache-2.0 | Microsoft |
| windows-result | 0.4.1 | MIT OR Apache-2.0 | — |
| windows-strings | 0.4.2 | MIT OR Apache-2.0 | Microsoft |
| windows-strings | 0.5.1 | MIT OR Apache-2.0 | — |
| windows-sys | 0.48.0 | MIT OR Apache-2.0 | Microsoft |
| windows-sys | 0.52.0 | MIT OR Apache-2.0 | Microsoft |
| windows-sys | 0.59.0 | MIT OR Apache-2.0 | Microsoft |
| windows-sys | 0.60.2 | MIT OR Apache-2.0 | Microsoft |
| windows-sys | 0.61.2 | MIT OR Apache-2.0 | — |
| windows-targets | 0.48.5 | MIT OR Apache-2.0 | Microsoft |
| windows-targets | 0.52.6 | MIT OR Apache-2.0 | Microsoft |
| windows-targets | 0.53.5 | MIT OR Apache-2.0 | — |
| windows-threading | 0.1.0 | MIT OR Apache-2.0 | Microsoft |
| windows-threading | 0.2.1 | MIT OR Apache-2.0 | — |
| windows-version | 0.1.4 | MIT OR Apache-2.0 | Microsoft |
| windows_x86_64_msvc | 0.48.5 | MIT OR Apache-2.0 | Microsoft |
| windows_x86_64_msvc | 0.52.6 | MIT OR Apache-2.0 | Microsoft |
| windows_x86_64_msvc | 0.53.0 | MIT OR Apache-2.0 | Microsoft |
| winnow | 0.5.40 | MIT | — |
| winnow | 0.7.10 | MIT | — |
| winnow | 1.0.4 | MIT | — |
| winreg | 0.52.0 | MIT | Copyright (c) 2015 Igor Shaula |
| writeable | 0.6.1 | Unicode-3.0 | Copyright © 2020-2024 Unicode, Inc. |
| wry | 0.55.1 | Apache-2.0 OR MIT | Tauri Programme within The Commons Conservancy |
| x11 | 2.21.0 | MIT | daggerbot <daggerbot@gmail.com>, Erle Pereira <erle@erlepereira.com>, AltF02 <contact@altf2.dev> |
| x11-dl | 2.21.0 | MIT | daggerbot <daggerbot@gmail.com>, Erle Pereira <erle@erlepereira.com>, AltF02 <contact@altf2.dev> |
| xattr | 1.6.1 | MIT OR Apache-2.0 | Steven Allen <steven@stebalien.com> |
| yoke | 0.8.0 | Unicode-3.0 | Copyright © 2020-2024 Unicode, Inc. |
| yoke-derive | 0.8.0 | Unicode-3.0 | Copyright © 2020-2024 Unicode, Inc. |
| zbus | 5.19.0 | MIT | Copyright (c) 2024 Zeeshan Ali Khan & zbus contributors |
| zbus_macros | 5.19.0 | MIT | Copyright (c) 2024 Zeeshan Ali Khan & zbus contributors |
| zbus_names | 4.3.4 | MIT | Copyright (c) 2024 Zeeshan Ali Khan & zbus contributors |
| zcheapstr | 1.1.0 | MIT | Copyright (c) 2026 Zeeshan Ali Khan & zcheapstr contributors |
| zerocopy | 0.8.25 | BSD-2-Clause OR Apache-2.0 OR MIT | Joshua Liebow-Feeser <joshlf@google.com>, Jack Wrenn <jswrenn@amazon.com> |
| zerofrom | 0.1.6 | Unicode-3.0 | Copyright © 2020-2024 Unicode, Inc. |
| zerofrom-derive | 0.1.6 | Unicode-3.0 | Copyright © 2020-2024 Unicode, Inc. |
| zeroize | 1.8.2 | Apache-2.0 OR MIT | The RustCrypto Project Developers |
| zerotrie | 0.2.2 | Unicode-3.0 | Copyright © 2020-2024 Unicode, Inc. |
| zerovec | 0.11.2 | Unicode-3.0 | Copyright © 2020-2024 Unicode, Inc. |
| zerovec-derive | 0.11.1 | Unicode-3.0 | Copyright © 2020-2024 Unicode, Inc. |
| zip | 4.6.1 | MIT | Copyright (c) 2014 Mathijs van de Nes |
| zmij | 1.0.23 | MIT | David Tolnay <dtolnay@gmail.com> |
| zstd | 0.13.3 | MIT | Copyright (c) 2016 Alexandre Bury |
| zstd-safe | 7.2.4 | MIT OR Apache-2.0 | Copyright (c) 2016 Alexandre Bury |
| zstd-sys | 2.0.16+zstd.1.5.7 | MIT/Apache-2.0 | Copyright (c) 2016-present, Facebook, Inc. All rights reserved. |
| zvariant | 5.15.0 | MIT | Copyright (c) 2024 Zeeshan Ali Khan & zbus contributors |
| zvariant_derive | 5.15.0 | MIT | Copyright (c) 2024 Zeeshan Ali Khan & zbus contributors |
| zvariant_utils | 4.2.0 | MIT | Zeeshan Ali Khan <zeeshanak@gnome.org>, turbocooler <turbocooler@cocaine.ninja> |

## ライセンス本文

`OR` で複数から選べる依存は、次の優先順で1つを選び、選んだものの本文だけを載せている:
MIT > Apache-2.0 > ISC > BSD-2-Clause > BSD-3-Clause > Zlib > 0BSD > MIT-0 > Unlicense > CC0-1.0。
`AND` や括弧を含む式は解釈せず、出てくる識別子の本文を全部載せている。
本文が言う「上記の著作権表示」は、上の表の「著作権表示」欄を指す。

### 0BSD

```
Permission to use, copy, modify, and/or distribute this software for
any purpose with or without fee is hereby granted.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN
AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT
OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
```

### Apache-2.0

```
                              Apache License
                        Version 2.0, January 2004
                     https://www.apache.org/licenses/LICENSE-2.0

TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

1. Definitions.

   "License" shall mean the terms and conditions for use, reproduction,
   and distribution as defined by Sections 1 through 9 of this document.

   "Licensor" shall mean the copyright owner or entity authorized by
   the copyright owner that is granting the License.

   "Legal Entity" shall mean the union of the acting entity and all
   other entities that control, are controlled by, or are under common
   control with that entity. For the purposes of this definition,
   "control" means (i) the power, direct or indirect, to cause the
   direction or management of such entity, whether by contract or
   otherwise, or (ii) ownership of fifty percent (50%) or more of the
   outstanding shares, or (iii) beneficial ownership of such entity.

   "You" (or "Your") shall mean an individual or Legal Entity
   exercising permissions granted by this License.

   "Source" form shall mean the preferred form for making modifications,
   including but not limited to software source code, documentation
   source, and configuration files.

   "Object" form shall mean any form resulting from mechanical
   transformation or translation of a Source form, including but
   not limited to compiled object code, generated documentation,
   and conversions to other media types.

   "Work" shall mean the work of authorship, whether in Source or
   Object form, made available under the License, as indicated by a
   copyright notice that is included in or attached to the work
   (an example is provided in the Appendix below).

   "Derivative Works" shall mean any work, whether in Source or Object
   form, that is based on (or derived from) the Work and for which the
   editorial revisions, annotations, elaborations, or other modifications
   represent, as a whole, an original work of authorship. For the purposes
   of this License, Derivative Works shall not include works that remain
   separable from, or merely link (or bind by name) to the interfaces of,
   the Work and Derivative Works thereof.

   "Contribution" shall mean any work of authorship, including
   the original version of the Work and any modifications or additions
   to that Work or Derivative Works thereof, that is intentionally
   submitted to Licensor for inclusion in the Work by the copyright owner
   or by an individual or Legal Entity authorized to submit on behalf of
   the copyright owner. For the purposes of this definition, "submitted"
   means any form of electronic, verbal, or written communication sent
   to the Licensor or its representatives, including but not limited to
   communication on electronic mailing lists, source code control systems,
   and issue tracking systems that are managed by, or on behalf of, the
   Licensor for the purpose of discussing and improving the Work, but
   excluding communication that is conspicuously marked or otherwise
   designated in writing by the copyright owner as "Not a Contribution."

   "Contributor" shall mean Licensor and any individual or Legal Entity
   on behalf of whom a Contribution has been received by Licensor and
   subsequently incorporated within the Work.

2. Grant of Copyright License. Subject to the terms and conditions of
   this License, each Contributor hereby grants to You a perpetual,
   worldwide, non-exclusive, no-charge, royalty-free, irrevocable
   copyright license to reproduce, prepare Derivative Works of,
   publicly display, publicly perform, sublicense, and distribute the
   Work and such Derivative Works in Source or Object form.

3. Grant of Patent License. Subject to the terms and conditions of
   this License, each Contributor hereby grants to You a perpetual,
   worldwide, non-exclusive, no-charge, royalty-free, irrevocable
   (except as stated in this section) patent license to make, have made,
   use, offer to sell, sell, import, and otherwise transfer the Work,
   where such license applies only to those patent claims licensable
   by such Contributor that are necessarily infringed by their
   Contribution(s) alone or by combination of their Contribution(s)
   with the Work to which such Contribution(s) was submitted. If You
   institute patent litigation against any entity (including a
   cross-claim or counterclaim in a lawsuit) alleging that the Work
   or a Contribution incorporated within the Work constitutes direct
   or contributory patent infringement, then any patent licenses
   granted to You under this License for that Work shall terminate
   as of the date such litigation is filed.

4. Redistribution. You may reproduce and distribute copies of the
   Work or Derivative Works thereof in any medium, with or without
   modifications, and in Source or Object form, provided that You
   meet the following conditions:

   (a) You must give any other recipients of the Work or
       Derivative Works a copy of this License; and

   (b) You must cause any modified files to carry prominent notices
       stating that You changed the files; and

   (c) You must retain, in the Source form of any Derivative Works
       that You distribute, all copyright, patent, trademark, and
       attribution notices from the Source form of the Work,
       excluding those notices that do not pertain to any part of
       the Derivative Works; and

   (d) If the Work includes a "NOTICE" text file as part of its
       distribution, then any Derivative Works that You distribute must
       include a readable copy of the attribution notices contained
       within such NOTICE file, excluding those notices that do not
       pertain to any part of the Derivative Works, in at least one
       of the following places: within a NOTICE text file distributed
       as part of the Derivative Works; within the Source form or
       documentation, if provided along with the Derivative Works; or,
       within a display generated by the Derivative Works, if and
       wherever such third-party notices normally appear. The contents
       of the NOTICE file are for informational purposes only and
       do not modify the License. You may add Your own attribution
       notices within Derivative Works that You distribute, alongside
       or as an addendum to the NOTICE text from the Work, provided
       that such additional attribution notices cannot be construed
       as modifying the License.

   You may add Your own copyright statement to Your modifications and
   may provide additional or different license terms and conditions
   for use, reproduction, or distribution of Your modifications, or
   for any such Derivative Works as a whole, provided Your use,
   reproduction, and distribution of the Work otherwise complies with
   the conditions stated in this License.

5. Submission of Contributions. Unless You explicitly state otherwise,
   any Contribution intentionally submitted for inclusion in the Work
   by You to the Licensor shall be under the terms and conditions of
   this License, without any additional terms or conditions.
   Notwithstanding the above, nothing herein shall supersede or modify
   the terms of any separate license agreement you may have executed
   with Licensor regarding such Contributions.

6. Trademarks. This License does not grant permission to use the trade
   names, trademarks, service marks, or product names of the Licensor,
   except as required for reasonable and customary use in describing the
   origin of the Work and reproducing the content of the NOTICE file.

7. Disclaimer of Warranty. Unless required by applicable law or
   agreed to in writing, Licensor provides the Work (and each
   Contributor provides its Contributions) on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
   implied, including, without limitation, any warranties or conditions
   of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
   PARTICULAR PURPOSE. You are solely responsible for determining the
   appropriateness of using or redistributing the Work and assume any
   risks associated with Your exercise of permissions under this License.

8. Limitation of Liability. In no event and under no legal theory,
   whether in tort (including negligence), contract, or otherwise,
   unless required by applicable law (such as deliberate and grossly
   negligent acts) or agreed to in writing, shall any Contributor be
   liable to You for damages, including any direct, indirect, special,
   incidental, or consequential damages of any character arising as a
   result of this License or out of the use or inability to use the
   Work (including but not limited to damages for loss of goodwill,
   work stoppage, computer failure or malfunction, or any and all
   other commercial damages or losses), even if such Contributor
   has been advised of the possibility of such damages.

9. Accepting Warranty or Additional Liability. While redistributing
   the Work or Derivative Works thereof, You may choose to offer,
   and charge a fee for, acceptance of support, warranty, indemnity,
   or other liability obligations and/or rights consistent with this
   License. However, in accepting such obligations, You may act only
   on Your own behalf and on Your sole responsibility, not on behalf
   of any other Contributor, and only if You agree to indemnify,
   defend, and hold each Contributor harmless for any liability
   incurred by, or claims asserted against, such Contributor by reason
   of your accepting any such warranty or additional liability.

END OF TERMS AND CONDITIONS

APPENDIX: How to apply the Apache License to your work.

   To apply the Apache License to your work, attach the following
   boilerplate notice, with the fields enclosed by brackets "[]"
   replaced with your own identifying information. (Don't include
   the brackets!)  The text should be enclosed in the appropriate
   comment syntax for the file format. We also recommend that a
   file or class name and description of purpose be included on the
   same "printed page" as the copyright notice for easier
   identification within third-party archives.

Copyright [yyyy] [name of copyright owner]

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

	https://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```

### BSD-3-Clause

```
Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

### CC0-1.0

```
Creative Commons Legal Code

CC0 1.0 Universal

    CREATIVE COMMONS CORPORATION IS NOT A LAW FIRM AND DOES NOT PROVIDE
    LEGAL SERVICES. DISTRIBUTION OF THIS DOCUMENT DOES NOT CREATE AN
    ATTORNEY-CLIENT RELATIONSHIP. CREATIVE COMMONS PROVIDES THIS
    INFORMATION ON AN "AS-IS" BASIS. CREATIVE COMMONS MAKES NO WARRANTIES
    REGARDING THE USE OF THIS DOCUMENT OR THE INFORMATION OR WORKS
    PROVIDED HEREUNDER, AND DISCLAIMS LIABILITY FOR DAMAGES RESULTING FROM
    THE USE OF THIS DOCUMENT OR THE INFORMATION OR WORKS PROVIDED
    HEREUNDER.

Statement of Purpose

The laws of most jurisdictions throughout the world automatically confer
exclusive Copyright and Related Rights (defined below) upon the creator
and subsequent owner(s) (each and all, an "owner") of an original work of
authorship and/or a database (each, a "Work").

Certain owners wish to permanently relinquish those rights to a Work for
the purpose of contributing to a commons of creative, cultural and
scientific works ("Commons") that the public can reliably and without fear
of later claims of infringement build upon, modify, incorporate in other
works, reuse and redistribute as freely as possible in any form whatsoever
and for any purposes, including without limitation commercial purposes.
These owners may contribute to the Commons to promote the ideal of a free
culture and the further production of creative, cultural and scientific
works, or to gain reputation or greater distribution for their Work in
part through the use and efforts of others.

For these and/or other purposes and motivations, and without any
expectation of additional consideration or compensation, the person
associating CC0 with a Work (the "Affirmer"), to the extent that he or she
is an owner of Copyright and Related Rights in the Work, voluntarily
elects to apply CC0 to the Work and publicly distribute the Work under its
terms, with knowledge of his or her Copyright and Related Rights in the
Work and the meaning and intended legal effect of CC0 on those rights.

1. Copyright and Related Rights. A Work made available under CC0 may be
protected by copyright and related or neighboring rights ("Copyright and
Related Rights"). Copyright and Related Rights include, but are not
limited to, the following:

  i. the right to reproduce, adapt, distribute, perform, display,
     communicate, and translate a Work;
 ii. moral rights retained by the original author(s) and/or performer(s);
iii. publicity and privacy rights pertaining to a person's image or
     likeness depicted in a Work;
 iv. rights protecting against unfair competition in regards to a Work,
     subject to the limitations in paragraph 4(a), below;
  v. rights protecting the extraction, dissemination, use and reuse of data
     in a Work;
 vi. database rights (such as those arising under Directive 96/9/EC of the
     European Parliament and of the Council of 11 March 1996 on the legal
     protection of databases, and under any national implementation
     thereof, including any amended or successor version of such
     directive); and
vii. other similar, equivalent or corresponding rights throughout the
     world based on applicable law or treaty, and any national
     implementations thereof.

2. Waiver. To the greatest extent permitted by, but not in contravention
of, applicable law, Affirmer hereby overtly, fully, permanently,
irrevocably and unconditionally waives, abandons, and surrenders all of
Affirmer's Copyright and Related Rights and associated claims and causes
of action, whether now known or unknown (including existing as well as
future claims and causes of action), in the Work (i) in all territories
worldwide, (ii) for the maximum duration provided by applicable law or
treaty (including future time extensions), (iii) in any current or future
medium and for any number of copies, and (iv) for any purpose whatsoever,
including without limitation commercial, advertising or promotional
purposes (the "Waiver"). Affirmer makes the Waiver for the benefit of each
member of the public at large and to the detriment of Affirmer's heirs and
successors, fully intending that such Waiver shall not be subject to
revocation, rescission, cancellation, termination, or any other legal or
equitable action to disrupt the quiet enjoyment of the Work by the public
as contemplated by Affirmer's express Statement of Purpose.

3. Public License Fallback. Should any part of the Waiver for any reason
be judged legally invalid or ineffective under applicable law, then the
Waiver shall be preserved to the maximum extent permitted taking into
account Affirmer's express Statement of Purpose. In addition, to the
extent the Waiver is so judged Affirmer hereby grants to each affected
person a royalty-free, non transferable, non sublicensable, non exclusive,
irrevocable and unconditional license to exercise Affirmer's Copyright and
Related Rights in the Work (i) in all territories worldwide, (ii) for the
maximum duration provided by applicable law or treaty (including future
time extensions), (iii) in any current or future medium and for any number
of copies, and (iv) for any purpose whatsoever, including without
limitation commercial, advertising or promotional purposes (the
"License"). The License shall be deemed effective as of the date CC0 was
applied by Affirmer to the Work. Should any part of the License for any
reason be judged legally invalid or ineffective under applicable law, such
partial invalidity or ineffectiveness shall not invalidate the remainder
of the License, and in such case Affirmer hereby affirms that he or she
will not (i) exercise any of his or her remaining Copyright and Related
Rights in the Work or (ii) assert any associated claims and causes of
action with respect to the Work, in either case contrary to Affirmer's
express Statement of Purpose.

4. Limitations and Disclaimers.

 a. No trademark or patent rights held by Affirmer are waived, abandoned,
    surrendered, licensed or otherwise affected by this document.
 b. Affirmer offers the Work as-is and makes no representations or
    warranties of any kind concerning the Work, express, implied,
    statutory or otherwise, including without limitation warranties of
    title, merchantability, fitness for a particular purpose, non
    infringement, or the absence of latent or other defects, accuracy, or
    the present or absence of errors, whether or not discoverable, all to
    the greatest extent permissible under applicable law.
 c. Affirmer disclaims responsibility for clearing rights of other persons
    that may apply to the Work or any use thereof, including without
    limitation any person's Copyright and Related Rights in the Work.
    Further, Affirmer disclaims responsibility for obtaining any necessary
    consents, permissions or other rights required for any use of the
    Work.
 d. Affirmer understands and acknowledges that Creative Commons is not a
    party to this document and has no duty or obligation with respect to
    this CC0 or use of the Work.
```

### ISC

```
Permission to use, copy, modify, and/or distribute this software for any purpose
with or without fee is hereby granted, provided that the above copyright notice
and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND
FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS
OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER
TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF
THIS SOFTWARE.
```

### MIT

```
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

### MPL-2.0

```
Mozilla Public License Version 2.0
==================================

1. Definitions
--------------

1.1. "Contributor"
    means each individual or legal entity that creates, contributes to
    the creation of, or owns Covered Software.

1.2. "Contributor Version"
    means the combination of the Contributions of others (if any) used
    by a Contributor and that particular Contributor's Contribution.

1.3. "Contribution"
    means Covered Software of a particular Contributor.

1.4. "Covered Software"
    means Source Code Form to which the initial Contributor has attached
    the notice in Exhibit A, the Executable Form of such Source Code
    Form, and Modifications of such Source Code Form, in each case
    including portions thereof.

1.5. "Incompatible With Secondary Licenses"
    means

    (a) that the initial Contributor has attached the notice described
        in Exhibit B to the Covered Software; or

    (b) that the Covered Software was made available under the terms of
        version 1.1 or earlier of the License, but not also under the
        terms of a Secondary License.

1.6. "Executable Form"
    means any form of the work other than Source Code Form.

1.7. "Larger Work"
    means a work that combines Covered Software with other material, in 
    a separate file or files, that is not Covered Software.

1.8. "License"
    means this document.

1.9. "Licensable"
    means having the right to grant, to the maximum extent possible,
    whether at the time of the initial grant or subsequently, any and
    all of the rights conveyed by this License.

1.10. "Modifications"
    means any of the following:

    (a) any file in Source Code Form that results from an addition to,
        deletion from, or modification of the contents of Covered
        Software; or

    (b) any new file in Source Code Form that contains any Covered
        Software.

1.11. "Patent Claims" of a Contributor
    means any patent claim(s), including without limitation, method,
    process, and apparatus claims, in any patent Licensable by such
    Contributor that would be infringed, but for the grant of the
    License, by the making, using, selling, offering for sale, having
    made, import, or transfer of either its Contributions or its
    Contributor Version.

1.12. "Secondary License"
    means either the GNU General Public License, Version 2.0, the GNU
    Lesser General Public License, Version 2.1, the GNU Affero General
    Public License, Version 3.0, or any later versions of those
    licenses.

1.13. "Source Code Form"
    means the form of the work preferred for making modifications.

1.14. "You" (or "Your")
    means an individual or a legal entity exercising rights under this
    License. For legal entities, "You" includes any entity that
    controls, is controlled by, or is under common control with You. For
    purposes of this definition, "control" means (a) the power, direct
    or indirect, to cause the direction or management of such entity,
    whether by contract or otherwise, or (b) ownership of more than
    fifty percent (50%) of the outstanding shares or beneficial
    ownership of such entity.

2. License Grants and Conditions
--------------------------------

2.1. Grants

Each Contributor hereby grants You a world-wide, royalty-free,
non-exclusive license:

(a) under intellectual property rights (other than patent or trademark)
    Licensable by such Contributor to use, reproduce, make available,
    modify, display, perform, distribute, and otherwise exploit its
    Contributions, either on an unmodified basis, with Modifications, or
    as part of a Larger Work; and

(b) under Patent Claims of such Contributor to make, use, sell, offer
    for sale, have made, import, and otherwise transfer either its
    Contributions or its Contributor Version.

2.2. Effective Date

The licenses granted in Section 2.1 with respect to any Contribution
become effective for each Contribution on the date the Contributor first
distributes such Contribution.

2.3. Limitations on Grant Scope

The licenses granted in this Section 2 are the only rights granted under
this License. No additional rights or licenses will be implied from the
distribution or licensing of Covered Software under this License.
Notwithstanding Section 2.1(b) above, no patent license is granted by a
Contributor:

(a) for any code that a Contributor has removed from Covered Software;
    or

(b) for infringements caused by: (i) Your and any other third party's
    modifications of Covered Software, or (ii) the combination of its
    Contributions with other software (except as part of its Contributor
    Version); or

(c) under Patent Claims infringed by Covered Software in the absence of
    its Contributions.

This License does not grant any rights in the trademarks, service marks,
or logos of any Contributor (except as may be necessary to comply with
the notice requirements in Section 3.4).

2.4. Subsequent Licenses

No Contributor makes additional grants as a result of Your choice to
distribute the Covered Software under a subsequent version of this
License (see Section 10.2) or under the terms of a Secondary License (if
permitted under the terms of Section 3.3).

2.5. Representation

Each Contributor represents that the Contributor believes its
Contributions are its original creation(s) or it has sufficient rights
to grant the rights to its Contributions conveyed by this License.

2.6. Fair Use

This License is not intended to limit any rights You have under
applicable copyright doctrines of fair use, fair dealing, or other
equivalents.

2.7. Conditions

Sections 3.1, 3.2, 3.3, and 3.4 are conditions of the licenses granted
in Section 2.1.

3. Responsibilities
-------------------

3.1. Distribution of Source Form

All distribution of Covered Software in Source Code Form, including any
Modifications that You create or to which You contribute, must be under
the terms of this License. You must inform recipients that the Source
Code Form of the Covered Software is governed by the terms of this
License, and how they can obtain a copy of this License. You may not
attempt to alter or restrict the recipients' rights in the Source Code
Form.

3.2. Distribution of Executable Form

If You distribute Covered Software in Executable Form then:

(a) such Covered Software must also be made available in Source Code
    Form, as described in Section 3.1, and You must inform recipients of
    the Executable Form how they can obtain a copy of such Source Code
    Form by reasonable means in a timely manner, at a charge no more
    than the cost of distribution to the recipient; and

(b) You may distribute such Executable Form under the terms of this
    License, or sublicense it under different terms, provided that the
    license for the Executable Form does not attempt to limit or alter
    the recipients' rights in the Source Code Form under this License.

3.3. Distribution of a Larger Work

You may create and distribute a Larger Work under terms of Your choice,
provided that You also comply with the requirements of this License for
the Covered Software. If the Larger Work is a combination of Covered
Software with a work governed by one or more Secondary Licenses, and the
Covered Software is not Incompatible With Secondary Licenses, this
License permits You to additionally distribute such Covered Software
under the terms of such Secondary License(s), so that the recipient of
the Larger Work may, at their option, further distribute the Covered
Software under the terms of either this License or such Secondary
License(s).

3.4. Notices

You may not remove or alter the substance of any license notices
(including copyright notices, patent notices, disclaimers of warranty,
or limitations of liability) contained within the Source Code Form of
the Covered Software, except that You may alter any license notices to
the extent required to remedy known factual inaccuracies.

3.5. Application of Additional Terms

You may choose to offer, and to charge a fee for, warranty, support,
indemnity or liability obligations to one or more recipients of Covered
Software. However, You may do so only on Your own behalf, and not on
behalf of any Contributor. You must make it absolutely clear that any
such warranty, support, indemnity, or liability obligation is offered by
You alone, and You hereby agree to indemnify every Contributor for any
liability incurred by such Contributor as a result of warranty, support,
indemnity or liability terms You offer. You may include additional
disclaimers of warranty and limitations of liability specific to any
jurisdiction.

4. Inability to Comply Due to Statute or Regulation
---------------------------------------------------

If it is impossible for You to comply with any of the terms of this
License with respect to some or all of the Covered Software due to
statute, judicial order, or regulation then You must: (a) comply with
the terms of this License to the maximum extent possible; and (b)
describe the limitations and the code they affect. Such description must
be placed in a text file included with all distributions of the Covered
Software under this License. Except to the extent prohibited by statute
or regulation, such description must be sufficiently detailed for a
recipient of ordinary skill to be able to understand it.

5. Termination
--------------

5.1. The rights granted under this License will terminate automatically
if You fail to comply with any of its terms. However, if You become
compliant, then the rights granted under this License from a particular
Contributor are reinstated (a) provisionally, unless and until such
Contributor explicitly and finally terminates Your grants, and (b) on an
ongoing basis, if such Contributor fails to notify You of the
non-compliance by some reasonable means prior to 60 days after You have
come back into compliance. Moreover, Your grants from a particular
Contributor are reinstated on an ongoing basis if such Contributor
notifies You of the non-compliance by some reasonable means, this is the
first time You have received notice of non-compliance with this License
from such Contributor, and You become compliant prior to 30 days after
Your receipt of the notice.

5.2. If You initiate litigation against any entity by asserting a patent
infringement claim (excluding declaratory judgment actions,
counter-claims, and cross-claims) alleging that a Contributor Version
directly or indirectly infringes any patent, then the rights granted to
You by any and all Contributors for the Covered Software under Section
2.1 of this License shall terminate.

5.3. In the event of termination under Sections 5.1 or 5.2 above, all
end user license agreements (excluding distributors and resellers) which
have been validly granted by You or Your distributors under this License
prior to termination shall survive termination.

************************************************************************
*                                                                      *
*  6. Disclaimer of Warranty                                           *
*  -------------------------                                           *
*                                                                      *
*  Covered Software is provided under this License on an "as is"       *
*  basis, without warranty of any kind, either expressed, implied, or  *
*  statutory, including, without limitation, warranties that the       *
*  Covered Software is free of defects, merchantable, fit for a        *
*  particular purpose or non-infringing. The entire risk as to the     *
*  quality and performance of the Covered Software is with You.        *
*  Should any Covered Software prove defective in any respect, You     *
*  (not any Contributor) assume the cost of any necessary servicing,   *
*  repair, or correction. This disclaimer of warranty constitutes an   *
*  essential part of this License. No use of any Covered Software is   *
*  authorized under this License except under this disclaimer.         *
*                                                                      *
************************************************************************

************************************************************************
*                                                                      *
*  7. Limitation of Liability                                          *
*  --------------------------                                          *
*                                                                      *
*  Under no circumstances and under no legal theory, whether tort      *
*  (including negligence), contract, or otherwise, shall any           *
*  Contributor, or anyone who distributes Covered Software as          *
*  permitted above, be liable to You for any direct, indirect,         *
*  special, incidental, or consequential damages of any character      *
*  including, without limitation, damages for lost profits, loss of    *
*  goodwill, work stoppage, computer failure or malfunction, or any    *
*  and all other commercial damages or losses, even if such party      *
*  shall have been informed of the possibility of such damages. This   *
*  limitation of liability shall not apply to liability for death or   *
*  personal injury resulting from such party's negligence to the       *
*  extent applicable law prohibits such limitation. Some               *
*  jurisdictions do not allow the exclusion or limitation of           *
*  incidental or consequential damages, so this exclusion and          *
*  limitation may not apply to You.                                    *
*                                                                      *
************************************************************************

8. Litigation
-------------

Any litigation relating to this License may be brought only in the
courts of a jurisdiction where the defendant maintains its principal
place of business and such litigation shall be governed by laws of that
jurisdiction, without reference to its conflict-of-law provisions.
Nothing in this Section shall prevent a party's ability to bring
cross-claims or counter-claims.

9. Miscellaneous
----------------

This License represents the complete agreement concerning the subject
matter hereof. If any provision of this License is held to be
unenforceable, such provision shall be reformed only to the extent
necessary to make it enforceable. Any law or regulation which provides
that the language of a contract shall be construed against the drafter
shall not be used to construe this License against a Contributor.

10. Versions of the License
---------------------------

10.1. New Versions

Mozilla Foundation is the license steward. Except as provided in Section
10.3, no one other than the license steward has the right to modify or
publish new versions of this License. Each version will be given a
distinguishing version number.

10.2. Effect of New Versions

You may distribute the Covered Software under the terms of the version
of the License under which You originally received the Covered Software,
or under the terms of any subsequent version published by the license
steward.

10.3. Modified Versions

If you create software not governed by this License, and you want to
create a new license for such software, you may create and use a
modified version of this License if you rename the license and remove
any references to the name of the license steward (except to note that
such modified license differs from this License).

10.4. Distributing Source Code Form that is Incompatible With Secondary
Licenses

If You choose to distribute Source Code Form that is Incompatible With
Secondary Licenses under the terms of this version of the License, the
notice described in Exhibit B of this License must be attached.

Exhibit A - Source Code Form License Notice
-------------------------------------------

  This Source Code Form is subject to the terms of the Mozilla Public
  License, v. 2.0. If a copy of the MPL was not distributed with this
  file, You can obtain one at http://mozilla.org/MPL/2.0/.

If it is not possible or desirable to put the notice in a particular
file, then You may include the notice in a location (such as a LICENSE
file in a relevant directory) where a recipient would be likely to look
for such a notice.

You may add additional accurate notices of copyright ownership.

Exhibit B - "Incompatible With Secondary Licenses" Notice
---------------------------------------------------------

  This Source Code Form is "Incompatible With Secondary Licenses", as
  defined by the Mozilla Public License, v. 2.0.
```

### OFL-1.1

```
-----------------------------------------------------------
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
-----------------------------------------------------------

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded,
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply
to any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software components as
distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting -- in part or in whole -- any of the components of the
Original Version, by changing formats or by porting the Font Software to a
new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components,
in Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the corresponding
Copyright Holder. This restriction only applies to the primary font name as
presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created
using the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.
```

### Unicode-3.0

```
UNICODE LICENSE V3

COPYRIGHT AND PERMISSION NOTICE

Copyright © 2020-2024 Unicode, Inc.

NOTICE TO USER: Carefully read the following legal agreement. BY
DOWNLOADING, INSTALLING, COPYING OR OTHERWISE USING DATA FILES, AND/OR
SOFTWARE, YOU UNEQUIVOCALLY ACCEPT, AND AGREE TO BE BOUND BY, ALL OF THE
TERMS AND CONDITIONS OF THIS AGREEMENT. IF YOU DO NOT AGREE, DO NOT
DOWNLOAD, INSTALL, COPY, DISTRIBUTE OR USE THE DATA FILES OR SOFTWARE.

Permission is hereby granted, free of charge, to any person obtaining a
copy of data files and any associated documentation (the "Data Files") or
software and any associated documentation (the "Software") to deal in the
Data Files or Software without restriction, including without limitation
the rights to use, copy, modify, merge, publish, distribute, and/or sell
copies of the Data Files or Software, and to permit persons to whom the
Data Files or Software are furnished to do so, provided that either (a)
this copyright and permission notice appear with all copies of the Data
Files or Software, or (b) this copyright and permission notice appear in
associated Documentation.

THE DATA FILES AND SOFTWARE ARE PROVIDED "AS IS", WITHOUT WARRANTY OF ANY
KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT OF
THIRD PARTY RIGHTS.

IN NO EVENT SHALL THE COPYRIGHT HOLDER OR HOLDERS INCLUDED IN THIS NOTICE
BE LIABLE FOR ANY CLAIM, OR ANY SPECIAL INDIRECT OR CONSEQUENTIAL DAMAGES,
OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS,
WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION,
ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THE DATA
FILES OR SOFTWARE.

Except as contained in this notice, the name of a copyright holder shall
not be used in advertising or otherwise to promote the sale, use or other
dealings in these Data Files or Software without prior written
authorization of the copyright holder.

SPDX-License-Identifier: Unicode-3.0

—

Portions of ICU4X may have been adapted from ICU4C and/or ICU4J.
ICU 1.8.1 to ICU 57.1 © 1995-2016 International Business Machines Corporation and others.
```

### Zlib

```
This software is provided 'as-is', without any express or implied warranty. In no event will the authors be held liable for any damages arising from the use of this software.

Permission is granted to anyone to use this software for any purpose, including commercial applications, and to alter it and redistribute it freely, subject to the following restrictions:

1. The origin of this software must not be misrepresented; you must not claim that you wrote the original software. If you use this software in a product, an acknowledgment in the product documentation would be appreciated but is not required.

2. Altered source versions must be plainly marked as such, and must not be misrepresented as being the original software.

3. This notice may not be removed or altered from any source distribution.
```
