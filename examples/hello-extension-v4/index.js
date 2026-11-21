(function () {
  const extensions = (window.SparkExtensions =
    window.SparkExtensions || {});

  extensions["demo.hello"] = function (runtime) {
    const React = runtime.React;

    function HelloTile() {
      return React.createElement(
        "div",
        { className: "hello-tile" },
        React.createElement("h2", null, "Hello"),
        React.createElement(
          "p",
          null,
          "Cette tuile vient d’une extension importée localement.",
        ),
      );
    }

    return {
      activate(api) {
        api.tiles.register({
          type: "demo.hello.tile",
          title: "Hello",
          guide: "Tuile de démonstration importée localement.",
          describe: () => "tuile de démonstration",
          view: HelloTile,
        });
        api.commands.register({
          id: "demo.hello.open",
          title: "Ouvrir Hello",
          tileType: "demo.hello.tile",
          run: () => api.tabs.openTile("demo.hello.tile"),
        });
      },
    };
  };
})();
