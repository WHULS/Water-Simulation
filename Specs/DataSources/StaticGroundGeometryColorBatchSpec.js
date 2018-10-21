defineSuite([
        'DataSources/StaticGroundGeometryColorBatch',
        'Core/defaultValue',
        'Core/ApproximateTerrainHeights',
        'Core/Cartesian3',
        'Core/Color',
        'Core/DistanceDisplayCondition',
        'Core/JulianDate',
        'Core/Math',
        'Core/TimeInterval',
        'Core/TimeIntervalCollection',
        'DataSources/CallbackProperty',
        'DataSources/ColorMaterialProperty',
        'DataSources/EllipseGeometryUpdater',
        'DataSources/Entity',
        'DataSources/TimeIntervalCollectionProperty',
        'Scene/ClassificationType',
        'Scene/GroundPrimitive',
        'Specs/createScene',
        'Specs/pollToPromise'
    ], function(
        StaticGroundGeometryColorBatch,
        defaultValue,
        ApproximateTerrainHeights,
        Cartesian3,
        Color,
        DistanceDisplayCondition,
        JulianDate,
        CesiumMath,
        TimeInterval,
        TimeIntervalCollection,
        CallbackProperty,
        ColorMaterialProperty,
        EllipseGeometryUpdater,
        Entity,
        TimeIntervalCollectionProperty,
        ClassificationType,
        GroundPrimitive,
        createScene,
        pollToPromise) {
    'use strict';

    var time = JulianDate.now();
    var scene;
    beforeAll(function() {
        scene = createScene();

        return GroundPrimitive.initializeTerrainHeights();
    });

    afterAll(function() {
        scene.destroyForSpecs();

        // Leave ground primitive uninitialized
        GroundPrimitive._initialized = false;
        GroundPrimitive._initPromise = undefined;
        ApproximateTerrainHeights._initPromise = undefined;
        ApproximateTerrainHeights._terrainHeights = undefined;
    });

    function computeKey(color, zIndex) {
        var ui8 = new Uint8Array(color);
        var ui32 = new Uint32Array(ui8.buffer);
        zIndex = defaultValue(zIndex, 0);
        return ui32[0] + ':' + zIndex;
    }

    it('updates color attribute after rebuilding primitive', function() {
        if (!GroundPrimitive.isSupported(scene)) {
            return;
        }

        var batch = new StaticGroundGeometryColorBatch(scene.groundPrimitives, ClassificationType.BOTH);
        var entity = new Entity({
            position : new Cartesian3(1234, 5678, 9101112),
            ellipse : {
                semiMajorAxis : 2,
                semiMinorAxis : 1,
                show : new CallbackProperty(function() {
                    return true;
                }, false),
                material : Color.RED
            }
        });

        var updater = new EllipseGeometryUpdater(entity, scene);
        batch.add(time, updater);

        return pollToPromise(function() {
            scene.initializeFrame();
            var isUpdated = batch.update(time);
            scene.render(time);
            return isUpdated;
        }).then(function() {
            expect(scene.groundPrimitives.length).toEqual(1);
            var primitive = scene.groundPrimitives.get(0);
            var attributes = primitive.getGeometryInstanceAttributes(entity);
            var red = [255, 0, 0, 255];
            var redKey = computeKey(red);
            expect(attributes.color).toEqual(red);

            // Verify we have 1 batch with the key for red
            expect(batch._batches.length).toEqual(1);
            expect(batch._batches.contains(redKey)).toBe(true);
            expect(batch._batches.get(redKey).key).toEqual(redKey);

            entity.ellipse.material = Color.GREEN;
            updater._onEntityPropertyChanged(entity, 'ellipse');
            batch.remove(updater);
            batch.add(time, updater);
            return pollToPromise(function() {
                scene.initializeFrame();
                var isUpdated = batch.update(time);
                scene.render(time);
                return isUpdated;
            }).then(function() {
                expect(scene.groundPrimitives.length).toEqual(1);
                var primitive = scene.groundPrimitives.get(0);
                var attributes = primitive.getGeometryInstanceAttributes(entity);
                var green = [0, 128, 0, 255];
                var greenKey = computeKey(green);
                expect(attributes.color).toEqual(green);

                // Verify we have 1 batch with the key for green
                expect(batch._batches.length).toEqual(1);
                expect(batch._batches.contains(greenKey)).toBe(true);
                expect(batch._batches.get(greenKey).key).toEqual(greenKey);

                batch.removeAllPrimitives();
            });
        });
    });

    it('updates with sampled distance display condition out of range', function() {
        var validTime = JulianDate.fromIso8601('2018-02-14T04:10:00+1100');
        var ddc = new TimeIntervalCollectionProperty();
        ddc.intervals.addInterval(TimeInterval.fromIso8601({
            iso8601: '2018-02-14T04:00:00+1100/2018-02-14T04:15:00+1100',
            data: new DistanceDisplayCondition(1.0, 2.0)
        }));
        var entity = new Entity({
            availability: new TimeIntervalCollection([TimeInterval.fromIso8601({iso8601: '2018-02-14T04:00:00+1100/2018-02-14T04:30:00+1100'})]),
            position : new Cartesian3(1234, 5678, 9101112),
            ellipse: {
                semiMajorAxis : 2,
                semiMinorAxis : 1,
                material: Color.RED,
                distanceDisplayCondition: ddc
            }
        });

        var batch = new StaticGroundGeometryColorBatch(scene.groundPrimitives, ClassificationType.BOTH);

        var updater = new EllipseGeometryUpdater(entity, scene);
        batch.add(validTime, updater);

        return pollToPromise(function() {
            scene.initializeFrame();
            var isUpdated = batch.update(validTime);
            scene.render(validTime);
            return isUpdated;
        }).then(function() {
            expect(scene.groundPrimitives.length).toEqual(1);
            var primitive = scene.groundPrimitives.get(0);
            var attributes = primitive.getGeometryInstanceAttributes(entity);
            expect(attributes.distanceDisplayCondition).toEqualEpsilon([1.0, 2.0], CesiumMath.EPSILON6);

            batch.update(time);
            scene.render(time);

            primitive = scene.groundPrimitives.get(0);
            attributes = primitive.getGeometryInstanceAttributes(entity);
            expect(attributes.distanceDisplayCondition).toEqual([0.0, Infinity]);

            batch.removeAllPrimitives();
        });
    });

    it('shows only one primitive while rebuilding primitive', function() {
        if (!GroundPrimitive.isSupported(scene)) {
            return;
        }

        var batch = new StaticGroundGeometryColorBatch(scene.groundPrimitives, ClassificationType.BOTH);
        function buildEntity() {
            return new Entity({
                position : new Cartesian3(1234, 5678, 9101112),
                ellipse : {
                    semiMajorAxis : 2,
                    semiMinorAxis : 1,
                    height : 0,
                    outline : true,
                    outlineColor : Color.RED.withAlpha(0.5)
                }
            });
        }

        function renderScene() {
            scene.initializeFrame();
            var isUpdated = batch.update(time);
            scene.render(time);
            return isUpdated;
        }

        var entity1 = buildEntity();
        var entity2 = buildEntity();

        var updater1 = new EllipseGeometryUpdater(entity1, scene);
        var updater2 = new EllipseGeometryUpdater(entity2, scene);

        batch.add(time, updater1);
        return pollToPromise(renderScene)
            .then(function() {
                expect(scene.groundPrimitives.length).toEqual(1);
                var primitive = scene.groundPrimitives.get(0);
                expect(primitive.show).toBeTruthy();
            })
            .then(function() {
                batch.add(time, updater2);
            })
            .then(function() {
                return pollToPromise(function() {
                    renderScene();
                    return scene.groundPrimitives.length === 2;
                });
            })
            .then(function() {
                var showCount = 0;
                expect(scene.groundPrimitives.length).toEqual(2);
                showCount += !!scene.groundPrimitives.get(0).show;
                showCount += !!scene.groundPrimitives.get(1).show;
                expect(showCount).toEqual(1);
            })
            .then(function() {
                return pollToPromise(renderScene);
            })
            .then(function() {
                expect(scene.groundPrimitives.length).toEqual(1);
                var primitive = scene.groundPrimitives.get(0);
                expect(primitive.show).toBeTruthy();

                batch.removeAllPrimitives();
            });
    });
});
