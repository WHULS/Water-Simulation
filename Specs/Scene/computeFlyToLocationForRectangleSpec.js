defineSuite([
        'Scene/computeFlyToLocationForRectangle',
        'Core/EllipsoidTerrainProvider',
        'Core/Rectangle',
        'Scene/Globe',
        'Scene/SceneMode',
        'Specs/createScene',
        'ThirdParty/when'
    ], function(
        computeFlyToLocationForRectangle,
        EllipsoidTerrainProvider,
        Rectangle,
        Globe,
        SceneMode,
        createScene,
        when) {
    'use strict';

    var scene;

    beforeEach(function() {
        scene = createScene();
    });

    afterEach(function() {
        scene.destroyForSpecs();
    });

    function sampleTest(sceneMode){
        //Pretend we have terrain with availability.
        var terrainProvider = new EllipsoidTerrainProvider();
        terrainProvider.availability = {};

        scene.globe = new Globe();
        scene.terrainProvider = terrainProvider;
        scene.mode = sceneMode;

        var rectangle = new Rectangle(0.2, 0.4, 0.6, 0.8);
        var cartographics = [
            Rectangle.center(rectangle),
            Rectangle.southeast(rectangle),
            Rectangle.southwest(rectangle),
            Rectangle.northeast(rectangle),
            Rectangle.northwest(rectangle)
        ];

        // Mock sampleTerrainMostDetailed with same positions but with heights.
        var maxHeight = 1234;
        var sampledResults = [
            Rectangle.center(rectangle),
            Rectangle.southeast(rectangle),
            Rectangle.southwest(rectangle),
            Rectangle.northeast(rectangle),
            Rectangle.northwest(rectangle)
        ];
        sampledResults[0].height = 145;
        sampledResults[1].height = 1211;
        sampledResults[2].height = -123;
        sampledResults[3].height = maxHeight;

        spyOn(computeFlyToLocationForRectangle, '_sampleTerrainMostDetailed').and.returnValue(when.resolve(sampledResults));

        // Basically do the computation ourselves with our known values;
        var expectedResult;
        if (sceneMode === SceneMode.SCENE3D) {
            expectedResult = scene.mapProjection.ellipsoid.cartesianToCartographic(scene.camera.getRectangleCameraCoordinates(rectangle));
        } else {
            expectedResult = scene.mapProjection.unproject(scene.camera.getRectangleCameraCoordinates(rectangle));
        }
        expectedResult.height += maxHeight;

        return computeFlyToLocationForRectangle(rectangle, scene)
            .then(function(result) {
                expect(result).toEqual(expectedResult);
                expect(computeFlyToLocationForRectangle._sampleTerrainMostDetailed).toHaveBeenCalledWith(terrainProvider, cartographics);
            });
    }

    it('samples terrain and returns expected result in 3D', function() {
        return sampleTest(SceneMode.SCENE3D);
    });

    it('samples terrain and returns expected result in CV', function() {
        return sampleTest(SceneMode.COLUMBUS_VIEW);
    });

    it('returns original rectangle in 2D', function() {
        var terrainProvider = new EllipsoidTerrainProvider();
        terrainProvider.availability = {};

        scene.globe = new Globe();
        scene.terrainProvider = terrainProvider;
        scene.mode = SceneMode.SCENE2D;

        var rectangle = new Rectangle(0.2, 0.4, 0.6, 0.8);
        spyOn(computeFlyToLocationForRectangle, '_sampleTerrainMostDetailed');

        return computeFlyToLocationForRectangle(rectangle, scene)
            .then(function(result) {
                expect(result).toBe(rectangle);
                expect(computeFlyToLocationForRectangle._sampleTerrainMostDetailed).not.toHaveBeenCalled();
            });
    });

    it('returns original rectangle when terrain not available', function() {
        scene.globe = new Globe();
        scene.terrainProvider = new EllipsoidTerrainProvider();

        var rectangle = new Rectangle(0.2, 0.4, 0.6, 0.8);
        spyOn(computeFlyToLocationForRectangle, '_sampleTerrainMostDetailed');

        return computeFlyToLocationForRectangle(rectangle, scene)
            .then(function(result) {
                expect(result).toBe(rectangle);
                expect(computeFlyToLocationForRectangle._sampleTerrainMostDetailed).not.toHaveBeenCalled();
            });
    });

    it('waits for terrain to become ready', function() {
        var terrainProvider = new EllipsoidTerrainProvider();
        spyOn(terrainProvider.readyPromise, 'then').and.callThrough();

        scene.globe = new Globe();
        scene.terrainProvider = terrainProvider;

        var rectangle = new Rectangle(0.2, 0.4, 0.6, 0.8);
        return computeFlyToLocationForRectangle(rectangle, scene)
            .then(function(result) {
                expect(result).toBe(rectangle);
                expect(terrainProvider.readyPromise.then).toHaveBeenCalled();
            });
    });

    it('returns original rectangle when terrain undefined', function() {
        scene.terrainProvider = undefined;
        var rectangle = new Rectangle(0.2, 0.4, 0.6, 0.8);
        spyOn(computeFlyToLocationForRectangle, '_sampleTerrainMostDetailed');

        return computeFlyToLocationForRectangle(rectangle, scene)
            .then(function(result) {
                expect(result).toBe(rectangle);
                expect(computeFlyToLocationForRectangle._sampleTerrainMostDetailed).not.toHaveBeenCalled();
            });
    });
});
